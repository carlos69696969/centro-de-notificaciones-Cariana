const pool = require("../db/pool");
const { sendToAudience } = require("./notificationService");
const { buildCampaignDeepLink } = require("./deepLinkService");

function pickFirstString(candidates) {
  for (const value of candidates) {
    const text = String(value || "").trim();
    if (text) {
      return text;
    }
  }
  return "";
}

function truncateText(value, max = 90) {
  const text = String(value || "").trim();
  if (!text) {
    return "";
  }
  return text.length > max ? `${text.slice(0, max - 1)}...` : text;
}

const audienceLabelMap = {
  all_customers: "Todos los clientes",
  customers_with_previous_purchases: "Clientes con compras",
  abandoned_cart: "Carrito abandonado",
  inactive_customers: "Clientes inactivos"
};

function buildCampaignNotificationCopy(campaign) {
  const headline = truncateText(
    pickFirstString([campaign.name, campaign.title, "Nueva campana Cariana"]),
    52
  );
  const audienceLabel = audienceLabelMap[campaign.audience_type] || "Clientes seleccionados";
  const bodyMessage = truncateText(campaign.message, 90);

  const title = `Campana Cariana | ${headline}`;
  const parts = [`Segmento: ${audienceLabel}.`];
  if (bodyMessage) {
    parts.push(`Detalle: ${bodyMessage}.`);
  }
  parts.push("Toca para ver mas informacion.");

  return {
    title,
    message: parts.join(" "),
    audienceLabel
  };
}

async function createCampaign({
  shopDomain,
  name,
  title,
  message,
  deepLink,
  audienceType,
  audienceFilters,
  scheduledAt,
  createdBy
}) {
  const status = scheduledAt ? "scheduled" : "draft";
  const result = await pool.query(
    `
    INSERT INTO campaigns
      (shop_domain, name, title, message, deep_link, audience_type, audience_filters, status, scheduled_at, created_by)
    VALUES
      ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10)
    RETURNING *
    `,
    [
      shopDomain,
      name,
      title,
      message,
      deepLink || null,
      audienceType,
      JSON.stringify(audienceFilters || {}),
      status,
      scheduledAt || null,
      createdBy || "admin"
    ]
  );
  return result.rows[0];
}

async function getCampaigns(shopDomain) {
  const result = await pool.query(
    `SELECT * FROM campaigns WHERE shop_domain = $1 ORDER BY created_at DESC`,
    [shopDomain]
  );
  return result.rows;
}

async function sendCampaignNow(shopDomain, campaignId) {
  const campaignResult = await pool.query(
    `
    SELECT *
    FROM campaigns
    WHERE id = $1 AND shop_domain = $2
    `,
    [campaignId, shopDomain]
  );

  if (campaignResult.rowCount === 0) {
    throw new Error("Campaign not found");
  }

  const campaign = campaignResult.rows[0];
  const copy = buildCampaignNotificationCopy(campaign);
  const sendResult = await sendToAudience({
    shopDomain,
    audienceType: campaign.audience_type,
    title: copy.title,
    message: copy.message,
    deepLink: buildCampaignDeepLink({
      shopDomain,
      deepLink: campaign.deep_link
    }),
    data: {
      campaignId: campaign.id,
      campaignName: campaign.name,
      audienceType: campaign.audience_type,
      audienceLabel: copy.audienceLabel,
      deepLinkType: "campaign"
    },
    campaignId: campaign.id
  });

  await pool.query(
    `
    UPDATE campaigns
    SET status = 'sent', sent_at = NOW(), updated_at = NOW()
    WHERE id = $1
    `,
    [campaign.id]
  );

  return sendResult;
}

async function runScheduledCampaigns() {
  const result = await pool.query(
    `
    SELECT id, shop_domain
    FROM campaigns
    WHERE status = 'scheduled'
      AND scheduled_at IS NOT NULL
      AND scheduled_at <= NOW()
    `
  );

  for (const campaign of result.rows) {
    await sendCampaignNow(campaign.shop_domain, campaign.id);
  }
}

module.exports = {
  createCampaign,
  getCampaigns,
  sendCampaignNow,
  runScheduledCampaigns
};
