const pool = require("../db/pool");
const logger = require("../utils/logger");
const { getCustomerByShopifyId, getCustomerByEmail } = require("./customerService");
const { buildStoreCreditDeepLink } = require("./deepLinkService");
const { sendToCustomerTokens, sendToEmailTokens } = require("./notificationService");

const DEFAULT_DELAY_MS = 60 * 1000;
const STORE_CREDIT_TITLE = "¡Tienes crédito en CARIANA! 💸";

function cleanText(value) {
  return String(value || "").trim();
}

function parseShopifyNumericId(value) {
  const text = cleanText(value);
  if (!text) return null;
  if (/^\d+$/.test(text)) return text;
  const match = text.match(/(\d+)(?!.*\d)/);
  return match ? match[1] : null;
}

function normalizeCurrency(value) {
  return cleanText(value || "MXN").toUpperCase() || "MXN";
}

function moneyNumber(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number : 0;
}

function roundMoney(value) {
  return Math.round((moneyNumber(value) + Number.EPSILON) * 100) / 100;
}

function formatCreditAmount(amount, currencyCode = "MXN") {
  const formatted = new Intl.NumberFormat("es-MX", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(roundMoney(amount));
  return `$${formatted} ${normalizeCurrency(currencyCode)}`;
}

function buildStoreCreditMessage(amount, currencyCode = "MXN") {
  return `Se agregaron ${formatCreditAmount(amount, currencyCode)} de crédito en tu cuenta de CARIANA. Úsalos en tu próxima compra o acumúlalos para después. 🎁 CARIANA te agradece por ser parte de nuestra comunidad.`;
}

function notificationDeepLink(shopDomain, sourceKey) {
  return buildStoreCreditDeepLink({
    shopDomain,
    sourceKey
  });
}

async function scheduleStoreCreditNotification({
  shopDomain,
  sourceKey,
  shopifyCustomerId,
  customerEmail,
  orderId,
  orderNumber,
  amount,
  currencyCode,
  delayMs = DEFAULT_DELAY_MS,
  sendNow = false
}) {
  const normalizedShop = cleanText(shopDomain).toLowerCase();
  const normalizedSourceKey = cleanText(sourceKey);
  const numericCustomerId = parseShopifyNumericId(shopifyCustomerId);
  const normalizedAmount = roundMoney(amount);
  const normalizedCurrency = normalizeCurrency(currencyCode);
  const normalizedEmail = cleanText(customerEmail).toLowerCase();

  if (!normalizedShop || !normalizedSourceKey || normalizedAmount <= 0) {
    return { skipped: true, reason: "missing_required_fields" };
  }

  const scheduledAt = sendNow
    ? new Date()
    : new Date(Date.now() + Math.max(0, Number(delayMs || DEFAULT_DELAY_MS)));
  const message = buildStoreCreditMessage(normalizedAmount, normalizedCurrency);

  const result = await pool.query(
    `
    INSERT INTO store_credit_notification_jobs
      (shop_domain, source_key, shopify_customer_id, customer_email, order_id, order_number, amount, currency_code, title, message, scheduled_at, status, updated_at)
    VALUES
      ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'scheduled',NOW())
    ON CONFLICT (shop_domain, source_key)
    DO UPDATE SET
      shopify_customer_id = EXCLUDED.shopify_customer_id,
      customer_email = EXCLUDED.customer_email,
      order_id = EXCLUDED.order_id,
      order_number = EXCLUDED.order_number,
      amount = EXCLUDED.amount,
      currency_code = EXCLUDED.currency_code,
      title = EXCLUDED.title,
      message = EXCLUDED.message,
      scheduled_at = EXCLUDED.scheduled_at,
      status = 'scheduled',
      error_message = NULL,
      updated_at = NOW()
    WHERE store_credit_notification_jobs.status IN ('scheduled', 'failed', 'skipped')
    RETURNING id, status, scheduled_at
    `,
    [
      normalizedShop,
      normalizedSourceKey,
      numericCustomerId,
      normalizedEmail || null,
      cleanText(orderId) || null,
      cleanText(orderNumber) || null,
      normalizedAmount,
      normalizedCurrency,
      STORE_CREDIT_TITLE,
      message,
      scheduledAt
    ]
  );

  if (result.rowCount === 0) {
    return { skipped: true, reason: "already_sent_or_sending" };
  }

  const scheduled = {
    scheduled: true,
    jobId: result.rows[0].id,
    scheduledAt: result.rows[0].scheduled_at
  };

  if (sendNow) {
    scheduled.sendResult = await processStoreCreditNotificationJob(result.rows[0].id);
  }

  return scheduled;
}

async function resolveJobCustomer(job) {
  const numericCustomerId = parseShopifyNumericId(job.shopify_customer_id);
  if (numericCustomerId) {
    const customer = await getCustomerByShopifyId(job.shop_domain, numericCustomerId);
    if (customer) return customer;
  }

  return getCustomerByEmail(job.shop_domain, job.customer_email);
}

async function sendStoreCreditNotificationJob(job) {
  const customer = await resolveJobCustomer(job);
  const deepLink = notificationDeepLink(job.shop_domain, job.source_key);
  const data = {
    notificationType: "store_credit_reward",
    deepLinkType: "store_credit",
    orderId: job.order_id || "",
    orderNumber: job.order_number || "",
    creditAmount: String(job.amount || ""),
    currencyCode: job.currency_code || "MXN",
    sourceKey: job.source_key || ""
  };

  if (customer?.id) {
    return sendToCustomerTokens({
      shopDomain: job.shop_domain,
      customerId: customer.id,
      type: "store_credit_reward",
      title: job.title,
      message: job.message,
      deepLink,
      data
    });
  }

  if (job.customer_email) {
    return sendToEmailTokens({
      shopDomain: job.shop_domain,
      email: job.customer_email,
      type: "store_credit_reward",
      title: job.title,
      message: job.message,
      deepLink,
      data
    });
  }

  return { sent: 0, failed: 0, stored: 0, total: 0, skipped: true, reason: "customer_not_found" };
}

async function processStoreCreditNotificationJob(jobId) {
  const locked = await pool.query(
    `
    UPDATE store_credit_notification_jobs
    SET status = 'sending', updated_at = NOW()
    WHERE id = $1
      AND status = 'scheduled'
      AND scheduled_at <= NOW()
    RETURNING *
    `,
    [jobId]
  );
  if (locked.rowCount === 0) {
    return { skipped: true, reason: "not_due_or_already_processing" };
  }

  const lockedJob = locked.rows[0];
  try {
    const sendResult = await sendStoreCreditNotificationJob(lockedJob);
    const delivered = Number(sendResult?.sent || 0) > 0 || Number(sendResult?.stored || 0) > 0;
    const skipped = Boolean(sendResult?.skipped) || (!delivered && Number(sendResult?.total || 0) === 0);
    const nextStatus = delivered ? "sent" : skipped ? "skipped" : "failed";
    await pool.query(
      `
      UPDATE store_credit_notification_jobs
      SET status = $2,
          sent_at = CASE WHEN $2 = 'sent' THEN NOW() ELSE sent_at END,
          send_result = $3::jsonb,
          error_message = $4,
          updated_at = NOW()
      WHERE id = $1
      `,
      [
        lockedJob.id,
        nextStatus,
        JSON.stringify(sendResult || {}),
        delivered ? null : cleanText(sendResult?.reason || "No active tokens")
      ]
    );

    return {
      status: nextStatus,
      sent: Number(sendResult?.sent || 0),
      stored: Number(sendResult?.stored || 0),
      failed: Number(sendResult?.failed || 0),
      total: Number(sendResult?.total || 0),
      reason: sendResult?.reason || null
    };
  } catch (error) {
    await pool.query(
      `
      UPDATE store_credit_notification_jobs
      SET status = 'failed',
          error_message = $2,
          updated_at = NOW()
      WHERE id = $1
      `,
      [lockedJob.id, cleanText(error?.message || error || "unknown").slice(0, 500)]
    );
    logger.error("Store credit notification job failed", {
      jobId: lockedJob.id,
      shopDomain: lockedJob.shop_domain,
      sourceKey: lockedJob.source_key,
      error: error?.message || error
    });
    return { status: "failed", error: cleanText(error?.message || error || "unknown") };
  }
}

async function runStoreCreditNotificationJobs({ limit = 50 } = {}) {
  const dueJobs = await pool.query(
    `
    SELECT *
    FROM store_credit_notification_jobs
    WHERE status = 'scheduled'
      AND scheduled_at <= NOW()
    ORDER BY scheduled_at ASC, id ASC
    LIMIT $1
    `,
    [Math.max(1, Math.min(200, Number(limit || 50)))]
  );

  let sentCount = 0;
  let skippedCount = 0;
  let failedCount = 0;

  for (const job of dueJobs.rows) {
    const result = await processStoreCreditNotificationJob(job.id);
    if (result.status === "sent") sentCount += 1;
    else if (result.status === "skipped" || result.skipped) skippedCount += 1;
    else failedCount += 1;
  }

  return { checked: dueJobs.rowCount, sent: sentCount, skipped: skippedCount, failed: failedCount };
}

module.exports = {
  scheduleStoreCreditNotification,
  processStoreCreditNotificationJob,
  runStoreCreditNotificationJobs
};
