
import { prisma } from "../../../src/lib/prisma";
import { verifyAuth } from "../../../src/lib/auth";

// GET /api/collections
export async function GET(request) {
  try {
    // 1. Verify JWT
    const auth = verifyAuth(request);

    if (!auth.success) {
      return Response.json(
        { success: false, message: auth.message },
        { status: auth.status }
      );
    }

    // 2. Admin sees all collections; sales reps see their own
    const where =
      auth.user.role === "ADMIN"
        ? {}
        : { userId: Number(auth.user.id) };

    const collections = await prisma.collection.findMany({
      where,
      orderBy: { createdAt: "desc" },
      include: {
        customer: true,
        user: {
          select: { id: true, name: true, email: true },
        },
      },
    });

    return Response.json({
      success: true,
      count: collections.length,
      collections,
    });
  } catch (error) {
    console.error("GET_COLLECTIONS_ERROR:", error);

    return Response.json(
      {
        success: false,
        message: "Failed to fetch collections",
      },
      { status: 500 }
    );
  }
}

// POST /api/collections
export async function POST(request) {
  try {
    // 1. Verify JWT
    const auth = verifyAuth(request);

    if (!auth.success) {
      return Response.json(
        { success: false, message: auth.message },
        { status: auth.status }
      );
    }

    const userIdNumber = Number(auth.user.id);

    // 2. Confirm the authenticated user exists and is active
    const user = await prisma.user.findUnique({
      where: { id: userIdNumber },
      select: { id: true, role: true, isActive: true },
    });

    if (!user || !user.isActive) {
      return Response.json(
        {
          success: false,
          message: "User not found or account is inactive",
        },
        { status: 403 }
      );
    }

    // 3. Read request body
    const body = await request.json();

    const {
      customerId,
      amount,
      paymentMethod,
      notes,
    } = body;

    const validPaymentMethods = [
      "CASH",
      "BANK_TRANSFER",
      "CARD",
    ];

    if (
      !Number.isInteger(Number(customerId)) ||
      Number(customerId) <= 0 ||
      amount === undefined ||
      amount === null ||
      !Number.isFinite(Number(amount)) ||
      Number(amount) <= 0 ||
      !validPaymentMethods.includes(paymentMethod)
    ) {
      return Response.json(
        {
          success: false,
          message:
            "Valid customerId, positive amount and paymentMethod are required",
        },
        { status: 400 }
      );
    }

    const customerIdNumber = Number(customerId);
    const collectionAmount = Number(amount);

    // 4. Validate customer permissions and collect atomically
    const collection = await prisma.$transaction(async (tx) => {
      const customer = await tx.customer.findUnique({
        where: { id: customerIdNumber },
      });

      if (!customer) {
        const error = new Error("Customer not found");
        error.status = 404;
        throw error;
      }

      // Sales reps can collect only from their assigned customers.
      // Admin can collect from any customer.
      if (
        user.role !== "ADMIN" &&
        customer.userId !== userIdNumber
      ) {
        const error = new Error(
          "You are not authorized to collect from this customer"
        );
        error.status = 403;
        throw error;
      }

      // 5. Prevent collecting more than the outstanding balance
      const updatedBalance = await tx.customer.updateMany({
        where: {
          id: customerIdNumber,
          balance: {
            gte: collectionAmount,
          },
        },
        data: {
          balance: {
            decrement: collectionAmount,
          },
        },
      });

      if (updatedBalance.count !== 1) {
        const error = new Error(
          "Collection amount exceeds the customer's outstanding balance"
        );
        error.status = 400;
        throw error;
      }

      // 6. Create collection using authenticated user's ID
      const newCollection = await tx.collection.create({
        data: {
          customerId: customerIdNumber,
          userId: userIdNumber,
          amount: collectionAmount,
          paymentMethod,
          notes: notes || null,
        },
      });

      return tx.collection.findUnique({
        where: { id: newCollection.id },
        include: {
          customer: true,
          user: {
            select: { id: true, name: true, email: true },
          },
        },
      });
    });

    return Response.json(
      {
        success: true,
        message: "Collection created successfully",
        collection,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("COLLECTIONS_API_ERROR:", error);

    if (error.status) {
      return Response.json(
        {
          success: false,
          message: error.message,
        },
        { status: error.status }
      );
    }

    return Response.json(
      {
        success: false,
        message: "Failed to process collections request",
      },
      { status: 500 }
    );
  }
}
