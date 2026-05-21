const pool = require("../db/pool");
const { sendToAudience } = require("./notificationService");

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
  const sendResult = await sendToAudience({
    shopDomain,
    audienceType: campaign.audience_type,
    title: campaign.title,
    message: campaign.message,
    deepLink: campaign.deep_link,
    data: {
      campaignId: campaign.id,
      campaignName: campaign.name
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
