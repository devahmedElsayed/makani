
import { prisma } from "../../../src/lib/prisma";
import { verifyAuth } from "../../../src/lib/auth";

function jsonError(message, status) {
  return Response.json(
    { success: false, message },
    { status }
  );
}

async function readJson(request) {
  try {
    return { success: true, data: await request.json() };
  } catch {
    return { success: false };
  }
}

// GET /api/orders
export async function GET(request) {
  try {
    const auth = verifyAuth(request);

    if (!auth.success) {
      return jsonError(auth.message, auth.status);
    }

    const userId = Number(auth.user.id);

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        role: true,
        isActive: true,
      },
    });

    if (!user || !user.isActive) {
      return jsonError(
        "User not found or account is inactive",
        403
      );
    }

    const where =
      user.role === "ADMIN"
        ? {}
        : { userId: user.id };

    const orders = await prisma.order.findMany({
      where,
      orderBy: { createdAt: "desc" },
      include: {
        customer: true,
        user: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
        items: {
          include: {
            product: true,
          },
        },
      },
    });

    return Response.json({
      success: true,
      count: orders.length,
      orders,
    });
  } catch (error) {
    console.error("GET_ORDERS_ERROR:", error);

    return jsonError("Failed to fetch orders", 500);
  }
}

// POST /api/orders
export async function POST(request) {
  try {
    const auth = verifyAuth(request);

    if (!auth.success) {
      return jsonError(auth.message, auth.status);
    }

    const userId = Number(auth.user.id);

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        role: true,
        isActive: true,
      },
    });

    if (!user || !user.isActive) {
      return jsonError(
        "User not found or account is inactive",
        403
      );
    }

    const parsed = await readJson(request);

    if (!parsed.success) {
      return jsonError(
        "Request body must be valid JSON",
        400
      );
    }

    const { customerId, items, notes } = parsed.data ?? {};

    if (
      customerId === undefined ||
      customerId === null ||
      !Number.isInteger(Number(customerId)) ||
      Number(customerId) <= 0
    ) {
      return jsonError("A valid customerId is required", 400);
    }

    if (!Array.isArray(items) || items.length === 0) {
      return jsonError(
        "A non-empty items array is required",
        400
      );
    }

    if (
      notes !== undefined &&
      notes !== null &&
      typeof notes !== "string"
    ) {
      return jsonError("Notes must be a string", 400);
    }

    // Merge duplicate product IDs and validate quantities.
    const quantities = new Map();

    for (const item of items) {
      if (!item || typeof item !== "object") {
        return jsonError("Each item must be an object", 400);
      }

      const productId = Number(item.productId);
      const quantity = Number(item.quantity);

      if (
        !Number.isInteger(productId) ||
        productId <= 0 ||
        !Number.isInteger(quantity) ||
        quantity <= 0
      ) {
        return jsonError(
          "Each item must have a valid productId and positive integer quantity",
          400
        );
      }

      quantities.set(
        productId,
        (quantities.get(productId) || 0) + quantity
      );
    }

    const customerIdNumber = Number(customerId);

    const order = await prisma.$transaction(async (tx) => {
      const customer = await tx.customer.findUnique({
        where: { id: customerIdNumber },
      });

      if (!customer) {
        const error = new Error("Customer not found");
        error.status = 404;
        throw error;
      }

      if (customer.status !== "ACTIVE") {
        const error = new Error(
          "Cannot create an order for an inactive customer"
        );
        error.status = 400;
        throw error;
      }

      // Sales reps can order for their assigned customers only.
      if (
        user.role !== "ADMIN" &&
        customer.userId !== user.id
      ) {
        const error = new Error(
          "You are not authorized to create an order for this customer"
        );
        error.status = 403;
        throw error;
      }

      const orderItems = [];
      let total = 0;

      for (const [productId, quantity] of quantities.entries()) {
        // Decrement stock only when the product is active
        // and enough stock is available.
        const stockUpdate = await tx.product.updateMany({
          where: {
            id: productId,
            isActive: true,
            stock: { gte: quantity },
          },
          data: {
            stock: { decrement: quantity },
          },
        });

        if (stockUpdate.count !== 1) {
          const product = await tx.product.findUnique({
            where: { id: productId },
            select: {
              id: true,
              isActive: true,
              stock: true,
            },
          });

          const error = new Error(
            !product || !product.isActive
              ? `Product ${productId} not found or inactive`
              : `Insufficient stock for product ${productId}`
          );

          error.status = 400;
          throw error;
        }

        const product = await tx.product.findUnique({
          where: { id: productId },
          select: {
            id: true,
            price: true,
          },
        });

        if (!product) {
          const error = new Error(
            `Product ${productId} not found`
          );
          error.status = 400;
          throw error;
        }

        const price = product.price;
        total += price * quantity;

        orderItems.push({
          productId,
          quantity,
          price,
        });
      }

      if (!Number.isFinite(total) || total <= 0) {
        const error = new Error("Invalid order total");
        error.status = 400;
        throw error;
      }

      const newOrder = await tx.order.create({
        data: {
          customerId: customer.id,
          userId: user.id,
          total,
          notes: notes?.trim() || null,
          status: "PENDING",
          items: {
            create: orderItems,
          },
        },
      });

      await tx.customer.update({
        where: { id: customer.id },
        data: {
          balance: {
            increment: total,
          },
        },
      });

      return tx.order.findUnique({
        where: { id: newOrder.id },
        include: {
          customer: true,
          user: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
          items: {
            include: {
              product: true,
            },
          },
        },
      });
    });

    return Response.json(
      {
        success: true,
        message: "Order created successfully",
        order,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("ORDERS_API_ERROR:", error);

    if (error.status) {
      return jsonError(error.message, error.status);
    }

    return jsonError(
      "Failed to process orders request",
      500
    );
  }
}
