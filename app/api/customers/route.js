
import { prisma } from "../../../src/lib/prisma";
import { verifyAuth } from "../../../src/lib/auth";

export async function GET(request) {
  try {
    const auth = verifyAuth(request);

    if (!auth.success) {
      return Response.json(
        {
          success: false,
          message: auth.message,
        },
        { status: auth.status }
      );
    }

    const where =
      auth.user.role === "ADMIN"
        ? {}
        : { userId: Number(auth.user.id) };

    const customers = await prisma.customer.findMany({
      where,
      orderBy: {
        createdAt: "desc",
      },
    });

    return Response.json({
      success: true,
      count: customers.length,
      customers,
    });
  } catch (error) {
    console.error("GET_CUSTOMERS_ERROR:", error);

    return Response.json(
      {
        success: false,
        message: "Failed to fetch customers",
      },
      { status: 500 }
    );
  }
}

export async function POST(request) {
  try {
    // 1. Verify JWT token
    const auth = verifyAuth(request);

    if (!auth.success) {
      return Response.json(
        {
          success: false,
          message: auth.message,
        },
        { status: auth.status }
      );
    }

    // 2. Read request body
    const body = await request.json();

    const {
      name,
      phone,
      email,
      address,
      latitude,
      longitude,
      notes,
    } = body;

    // 3. Validate required fields
    if (!name || typeof name !== "string" || !name.trim()) {
      return Response.json(
        {
          success: false,
          message: "Customer name is required",
        },
        { status: 400 }
      );
    }

    // 4. Validate coordinates if supplied
    const lat =
      latitude !== undefined && latitude !== null
        ? Number(latitude)
        : null;

    const lng =
      longitude !== undefined && longitude !== null
        ? Number(longitude)
        : null;

    if (
      (lat !== null && (!Number.isFinite(lat) || lat < -90 || lat > 90)) ||
      (lng !== null && (!Number.isFinite(lng) || lng < -180 || lng > 180))
    ) {
      return Response.json(
        {
          success: false,
          message: "Invalid latitude or longitude",
        },
        { status: 400 }
      );
    }

    // 5. Confirm the authenticated user still exists and is active
    const user = await prisma.user.findUnique({
      where: {
        id: Number(auth.user.id),
      },
      select: {
        id: true,
        isActive: true,
      },
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

    // 6. Create customer for the authenticated user
    const customer = await prisma.customer.create({
      data: {
        name: name.trim(),
        phone: phone || null,
        email: email || null,
        address: address || null,
        latitude: lat,
        longitude: lng,
        notes: notes || null,
        userId: user.id,
      },
    });

    return Response.json(
      {
        success: true,
        message: "Customer created successfully",
        customer,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("CREATE_CUSTOMER_ERROR:", error);

    return Response.json(
      {
        success: false,
        message: "Failed to create customer",
      },
      { status: 500 }
    );
  }
}
