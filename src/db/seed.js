const pool = require("./pool");
const logger = require("../utils/logger");

const templates = [
  {
    code: "order_confirmed",
    title: "Pedido confirmado",
    message: "Tu pedido ha sido confirmado."
  },
  {
    code: "order_preparing",
    title: "Pedido en preparacion",
    message: "Estamos preparando tu pedido."
  },
  {
    code: "order_shipped",
    title: "Pedido enviado",
    message: "Tu pedido ya fue enviado."
  },
  {
    code: "order_in_transit",
    title: "Pedido en camino",
    message: "Tu pedido ya va en camino."
  },
  {
    code: "order_delivered",
    title: "Pedido entregado",
    message: "Tu pedido ha sido entregado."
  },
  {
    code: "order_not_delivered",
    title: "Pedido no entregado 📦❌",
    message: "Pedido #**** 🚚. Pasamos a tu domicilio, pero no tuvimos respuesta al tocar la puerta ni al intentar comunicarnos contigo. Nuestro equipo realizará un nuevo intento de entrega mañana, en un horario de 8:00 a. m. a 8:00 p. m. 😉 ¡Gracias por tu comprensión!"
  },
  {
    code: "order_cancelled",
    title: "Pedido cancelado",
    message: "Tu pedido ha sido cancelado."
  },
  {
    code: "return_requested",
    title: "Devolucion solicitada",
    message: "Tu solicitud de devolucion ha sido recibida."
  },
  {
    code: "return_approved",
    title: "Devolucion aprobada",
    message: "Tu devolucion ha sido aprobada."
  },
  {
    code: "return_rejected",
    title: "Devolucion rechazada",
    message: "Tu devolucion ha sido rechazada."
  },
  {
    code: "return_expired",
    title: "Devolución vencida 🗓️❌",
    message:
      "Estimado cliente, la fecha límite para entregar tu devolución ha expirado. Lamentablemente, ya no podremos aceptar el producto."
  },
  {
    code: "return_pickup_scheduled",
    title: "Recoleccion programada",
    message: "La recoleccion de tu devolucion ya fue programada."
  },
  {
    code: "return_picked_up",
    title: "Producto recogido",
    message: "Hemos recogido el producto de tu devolucion."
  },
  {
    code: "refund_processed",
    title: "Reembolso procesado ✅",
    message: "Tu reembolso ya fue procesado."
  },
  {
    code: "refund_completed",
    title: "Reembolso completado",
    message: "Tu reembolso ha sido completado."
  },
  {
    code: "abandoned_cart_1h",
    title: "🛒 Carrito pendiente",
    message: "🔥 Tu carrito te está esperando. “Aún tienes productos en tu carrito. Finaliza tu compra antes de que se agoten.”"
  },
  {
    code: "abandoned_cart_24h",
    title: "🔥 Tu carrito te está esperando",
    message: "🛒 Algunos productos tienen alta demanda. Completa tu compra antes de que tus favoritos desaparezcan."
  },
  {
    code: "abandoned_cart_3d",
    title: "🔥 No pierdas lo que elegiste",
    message: "🛒 Tu carrito sigue disponible, pero algunos productos podrían agotarse pronto. Finaliza tu pedido ahora."
  }
];

async function seed() {
  for (const template of templates) {
    await pool.query(
      `
      INSERT INTO notification_templates (shop_domain, code, title, message, deep_link)
      VALUES (NULL, $1, $2, $3, NULL)
      ON CONFLICT (shop_domain, code) DO NOTHING
      `,
      [template.code, template.title, template.message]
    );
  }

  logger.info("Seed complete", { templates: templates.length });
  await pool.end();
}

seed().catch((error) => {
  logger.error("Seed failed", { error: error.message });
  process.exit(1);
});
