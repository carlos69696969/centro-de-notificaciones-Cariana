const pool = require("../db/pool");
const fcmService = require("./fcmService");
const env = require("../config/env");
const logger = require("../utils/logger");

const MAX_STORED_NOTIFICATIONS_PER_CUSTOMER = Number.isFinite(env.notificationsMaxPerCustomer) && env.notificationsMaxPerCustomer > 0
  ? Math.floor(env.notificationsMaxPerCustomer)
  : 50;

function normalizeData(input = {}) {
  const output = {};
  for (const [key, value] of Object.entries(input)) {
    output[key] = value == null ? "" : String(value);
  }
  return output;
}

async function markTokenInvalid(tokenId) {
  await pool.query(
    `
    UPDATE fcm_tokens
    SET is_active = FALSE, invalidated_at = NOW(), updated_at = NOW()
    WHERE id = $1
    `,
    [tokenId]
  );
}

async function pruneSentNotificationHistory({ shopDomain, customerId, tokenId }) {
  if (!shopDomain || MAX_STORED_NOTIFICATIONS_PER_CUSTOMER < 1) {
    return 0;
  }

  const normalizedCustomerId = Number(customerId || 0);
  const normalizedTokenId = Number(tokenId || 0);

  if (normalizedCustomerId > 0) {
    const result = await pool.query(
      `
      WITH stale AS (
        SELECT n.id
        FROM notifications n
        WHERE n.shop_domain = $1
          AND n.status = 'sent'
          AND n.customer_id = $2
        ORDER BY n.created_at DESC, n.id DESC
        OFFSET $3
      )
      DELETE FROM notifications n
      USING stale s
      WHERE n.id = s.id
      `,
      [shopDomain, normalizedCustomerId, MAX_STORED_NOTIFICATIONS_PER_CUSTOMER]
    );
    return result.rowCount || 0;
  }

  if (normalizedTokenId > 0) {
    const result = await pool.query(
      `
      WITH stale AS (
        SELECT n.id
        FROM notifications n
        WHERE n.shop_domain = $1
          AND n.status = 'sent'
          AND n.customer_id IS NULL
          AND n.fcm_token_id = $2
        ORDER BY n.created_at DESC, n.id DESC
        OFFSET $3
      )
      DELETE FROM notifications n
      USING stale s
      WHERE n.id = s.id
      `,
      [shopDomain, normalizedTokenId, MAX_STORED_NOTIFICATIONS_PER_CUSTOMER]
    );
    return result.rowCount || 0;
  }

  return 0;
}

async function insertNotificationRecord({
  shopDomain,
  customerId,
  tokenId,
  eventId,
  campaignId,
  type,
  title,
  message,
  deepLink,
  data,
  status,
  fcmMessageId,
  errorMessage
}) {
  const result = await pool.query(
    `
    INSERT INTO notifications
      (shop_domain, customer_id, fcm_token_id, event_id, campaign_id, type, title, message, deep_link, data, status, fcm_message_id, error_message)
    VALUES
      ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12,$13)
    RETURNING id
    `,
    [
      shopDomain,
      customerId || null,
      tokenId,
      eventId || null,
      campaignId || null,
      type,
      title,
      message,
      deepLink || null,
      JSON.stringify(data || {}),
      status,
      fcmMessageId || null,
      errorMessage || null
    ]
  );
  const notificationId = result.rows[0].id;

  if (status === "sent") {
    try {
      await pruneSentNotificationHistory({
        shopDomain,
        customerId,
        tokenId
      });
    } catch (error) {
      logger.warn("Notification retention prune failed", {
        shopDomain,
        customerId: customerId || null,
        tokenId: tokenId || null,
        error: error.message
      });
    }
  }

  return notificationId;
}

async function sendToCustomerTokens({
  shopDomain,
  customerId,
  type,
  title,
  message,
  deepLink,
  data,
  eventId,
  campaignId
}) {
  const tokensResult = await pool.query(
    `
    SELECT id, token
    FROM fcm_tokens
    WHERE shop_domain = $1
      AND customer_id = $2
      AND is_active = TRUE
    `,
    [shopDomain, customerId]
  );

  const tokens = tokensResult.rows;
  let sent = 0;
  let failed = 0;

  for (const tokenRow of tokens) {
    const payload = {
      title,
      body: message,
      data: normalizeData({
        deepLink: deepLink || "",
        deeplink: deepLink || "",
        deep_link: deepLink || "",
        deepLinkUrl: deepLink || "",
        deeplink_url: deepLink || "",
        url: deepLink || "",
        link: deepLink || "",
        targetUrl: deepLink || "",
        target_url: deepLink || "",
        openUrl: deepLink || "",
        open_url: deepLink || "",
        ...data
      })
    };

    const fcmResult = await fcmService.sendToToken(tokenRow.token, payload);
    if (fcmResult.ok) {
      sent += 1;
      await insertNotificationRecord({
        shopDomain,
        customerId,
        tokenId: tokenRow.id,
        eventId,
        campaignId,
        type,
        title,
        message,
        deepLink,
        data,
        status: "sent",
        fcmMessageId: fcmResult.messageId
      });
    } else {
      failed += 1;
      if (fcmResult.error && fcmResult.error.includes("registration-token-not-registered")) {
        await markTokenInvalid(tokenRow.id);
      }

      await insertNotificationRecord({
        shopDomain,
        customerId,
        tokenId: tokenRow.id,
        eventId,
        campaignId,
        type,
        title,
        message,
        deepLink,
        data,
        status: "failed",
        errorMessage: fcmResult.error
      });
    }
  }

  return { sent, failed, total: tokens.length };
}

async function sendToEmailTokens({
  shopDomain,
  email,
  type,
  title,
  message,
  deepLink,
  data,
  eventId,
  campaignId
}) {
  const normalizedEmail = String(email || "").trim().toLowerCase();
  if (!normalizedEmail) {
    return { sent: 0, failed: 0, total: 0 };
  }

  const exactShopTokens = await pool.query(
    `
    SELECT DISTINCT ON (t.id)
      t.id,
      t.token,
      t.customer_id
    FROM fcm_tokens t
    JOIN customers c ON c.id = t.customer_id
    WHERE t.shop_domain = $1
      AND t.is_active = TRUE
      AND LOWER(COALESCE(c.email, '')) = $2
    `,
    [shopDomain, normalizedEmail]
  );

  let tokens = exactShopTokens.rows;
  if (!tokens.length) {
    // Fallback: when a merchant changed store domain during setup, try matching by
    // customer email on active tokens from the same merchant database.
    const crossShopTokens = await pool.query(
      `
      SELECT DISTINCT ON (t.id)
        t.id,
        t.token,
        t.customer_id
      FROM fcm_tokens t
      JOIN customers c ON c.id = t.customer_id
      WHERE t.is_active = TRUE
        AND LOWER(COALESCE(c.email, '')) = $1
      `,
      [normalizedEmail]
    );
    tokens = crossShopTokens.rows;
  }
  let sent = 0;
  let failed = 0;

  for (const tokenRow of tokens) {
    const payload = {
      title,
      body: message,
      data: normalizeData({
        deepLink: deepLink || "",
        deeplink: deepLink || "",
        deep_link: deepLink || "",
        deepLinkUrl: deepLink || "",
        deeplink_url: deepLink || "",
        url: deepLink || "",
        link: deepLink || "",
        targetUrl: deepLink || "",
        target_url: deepLink || "",
        openUrl: deepLink || "",
        open_url: deepLink || "",
        ...data
      })
    };

    const fcmResult = await fcmService.sendToToken(tokenRow.token, payload);
    if (fcmResult.ok) {
      sent += 1;
      await insertNotificationRecord({
        shopDomain,
        customerId: tokenRow.customer_id || null,
        tokenId: tokenRow.id,
        eventId,
        campaignId,
        type,
        title,
        message,
        deepLink,
        data,
        status: "sent",
        fcmMessageId: fcmResult.messageId
      });
    } else {
      failed += 1;
      if (fcmResult.error && fcmResult.error.includes("registration-token-not-registered")) {
        await markTokenInvalid(tokenRow.id);
      }

      await insertNotificationRecord({
        shopDomain,
        customerId: tokenRow.customer_id || null,
        tokenId: tokenRow.id,
        eventId,
        campaignId,
        type,
        title,
        message,
        deepLink,
        data,
        status: "failed",
        errorMessage: fcmResult.error
      });
    }
  }

  return { sent, failed, total: tokens.length };
}

async function sendToAudience({
  shopDomain,
  audienceType,
  title,
  message,
  deepLink,
  data,
  campaignId
}) {
  let query = `
    SELECT DISTINCT c.id AS customer_id
    FROM customers c
    JOIN fcm_tokens t ON t.customer_id = c.id
    WHERE c.shop_domain = $1 AND t.is_active = TRUE
  `;

  if (audienceType === "customers_with_previous_purchases") {
    query += `
      AND EXISTS (
        SELECT 1
        FROM notification_events ne
        WHERE ne.shop_domain = c.shop_domain
          AND ne.topic IN ('orders/create','orders/updated','orders/fulfilled')
          AND (ne.payload->'customer'->>'id')::bigint = c.shopify_customer_id
      )
    `;
  } else if (audienceType === "abandoned_cart") {
    query += `
      AND EXISTS (
        SELECT 1
        FROM checkout_events ce
        WHERE ce.shop_domain = c.shop_domain
          AND ce.shopify_customer_id = c.shopify_customer_id
          AND ce.completed_at IS NULL
      )
    `;
  } else if (audienceType === "inactive_customers") {
    query += `
      AND NOT EXISTS (
        SELECT 1
        FROM notification_events ne
        WHERE ne.shop_domain = c.shop_domain
          AND ne.topic IN ('orders/create','orders/updated','orders/fulfilled')
          AND ne.created_at > NOW() - INTERVAL '90 days'
          AND (ne.payload->'customer'->>'id')::bigint = c.shopify_customer_id
      )
    `;
  }

  const customers = await pool.query(query, [shopDomain]);
  let totals = { sent: 0, failed: 0, total: 0 };

  for (const row of customers.rows) {
    const result = await sendToCustomerTokens({
      shopDomain,
      customerId: row.customer_id,
      type: "campaign",
      title,
      message,
      deepLink,
      data,
      campaignId
    });
    totals.sent += result.sent;
    totals.failed += result.failed;
    totals.total += result.total;
  }

  return totals;
}

module.exports = {
  sendToCustomerTokens,
  sendToEmailTokens,
  sendToAudience
};
