
import { prisma } from "../../../src/lib/prisma";
import { verifyAuth } from "../../../src/lib/auth";

// GET /api/visits
// جلب الزيارات المسموح للمستخدم بالاطلاع عليها
export async function GET(request) {
  try {
    const auth = verifyAuth(request);

    if (!auth.success) {
      return Response.json(
        { success: false, message: auth.message },
        { status: auth.status }
      );
    }

    const where =
      auth.user.role === "ADMIN"
        ? {}
        : { userId: Number(auth.user.id) };

    const visits = await prisma.visit.findMany({
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
      },
    });

    return Response.json({
      success: true,
      count: visits.length,
      visits,
    });
  } catch (error) {
    console.error("GET_VISITS_ERROR:", error);

    return Response.json(
      {
        success: false,
        message: "Failed to fetch visits",
      },
      { status: 500 }
    );
  }
}

// POST /api/visits
// بدء زيارة جديدة
export async function POST(request) {
  try {
    // 1. التحقق من JWT
    const auth = verifyAuth(request);

    if (!auth.success) {
      return Response.json(
        { success: false, message: auth.message },
        { status: auth.status }
      );
    }

    const userIdNumber = Number(auth.user.id);

    // 2. التأكد من أن الحساب موجود ونشط
    const user = await prisma.user.findUnique({
      where: { id: userIdNumber },
      select: {
        id: true,
        role: true,
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

    // 3. قراءة البيانات
    const body = await request.json();

    const {
      customerId,
      latitude,
      longitude,
      notes,
    } = body;

    if (
      !Number.isInteger(Number(customerId)) ||
      Number(customerId) <= 0
    ) {
      return Response.json(
        {
          success: false,
          message: "A valid customerId is required",
        },
        { status: 400 }
      );
    }

    const hasLatitude = latitude !== undefined && latitude !== null;
    const hasLongitude = longitude !== undefined && longitude !== null;

    if (hasLatitude !== hasLongitude) {
      return Response.json(
        {
          success: false,
          message: "Latitude and longitude must be provided together",
        },
        { status: 400 }
      );
    }

    const lat = hasLatitude ? Number(latitude) : null;
    const lng = hasLongitude ? Number(longitude) : null;

    if (
      hasLatitude &&
      (
        !Number.isFinite(lat) ||
        lat < -90 ||
        lat > 90 ||
        !Number.isFinite(lng) ||
        lng < -180 ||
        lng > 180
      )
    ) {
      return Response.json(
        {
          success: false,
          message: "Invalid latitude or longitude",
        },
        { status: 400 }
      );
    }

    const customerIdNumber = Number(customerId);

    // 4. بدء الزيارة داخل Transaction
    const result = await prisma.$transaction(async (tx) => {
      const customer = await tx.customer.findUnique({
        where: { id: customerIdNumber },
      });

      if (!customer) {
        const error = new Error("Customer not found");
        error.status = 404;
        throw error;
      }

      // المندوب لا يزور إلا العملاء التابعين له.
      // الأدمن يستطيع بدء زيارة لأي عميل.
      if (
        user.role !== "ADMIN" &&
        customer.userId !== userIdNumber
      ) {
        const error = new Error(
          "You are not authorized to visit this customer"
        );
        error.status = 403;
        throw error;
      }

      const activeVisit = await tx.visit.findFirst({
        where: {
          customerId: customerIdNumber,
          userId: userIdNumber,
          status: "IN_PROGRESS",
        },
      });

      if (activeVisit) {
        const error = new Error(
          "An active visit already exists for this customer"
        );
        error.status = 409;
        throw error;
      }

      return tx.visit.create({
        data: {
          customerId: customerIdNumber,
          userId: userIdNumber,
          status: "IN_PROGRESS",
          latitude: lat,
          longitude: lng,
          notes: notes || null,
          startedAt: new Date(),
        },
        include: {
          customer: true,
          user: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
        },
      });
    });

    return Response.json(
      {
        success: true,
        message: "Visit started successfully",
        visit: result,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("START_VISIT_ERROR:", error);

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
        message: "Failed to start visit",
      },
      { status: 500 }
    );
  }
}

// PATCH /api/visits
// إنهاء زيارة مفتوحة
export async function PATCH(request) {
  try {
    // 1. التحقق من JWT
    const auth = verifyAuth(request);

    if (!auth.success) {
      return Response.json(
        { success: false, message: auth.message },
        { status: auth.status }
      );
    }

    const userIdNumber = Number(auth.user.id);

    // 2. التأكد من أن الحساب موجود ونشط
    const user = await prisma.user.findUnique({
      where: { id: userIdNumber },
      select: {
        id: true,
        role: true,
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

    // 3. قراءة البيانات
    const body = await request.json();
    const { visitId, notes } = body;

    if (
      !Number.isInteger(Number(visitId)) ||
      Number(visitId) <= 0
    ) {
      return Response.json(
        {
          success: false,
          message: "A valid visitId is required",
        },
        { status: 400 }
      );
    }

    if (notes !== undefined && notes !== null &&
        typeof notes !== "string") {
      return Response.json(
        {
          success: false,
          message: "Notes must be a string",
        },
        { status: 400 }
      );
    }

    const visitIdNumber = Number(visitId);

    const result = await prisma.$transaction(async (tx) => {
      const visit = await tx.visit.findUnique({
        where: { id: visitIdNumber },
      });

      if (!visit) {
        const error = new Error("Visit not found");
        error.status = 404;
        throw error;
      }

      // المندوب لا يستطيع إنهاء زيارة مستخدم آخر
      if (
        user.role !== "ADMIN" &&
        visit.userId !== userIdNumber
      ) {
        const error = new Error(
          "You are not authorized to complete this visit"
        );
        error.status = 403;
        throw error;
      }

      if (visit.status !== "IN_PROGRESS") {
        const error = new Error(
          "Only an in-progress visit can be completed"
        );
        error.status = 409;
        throw error;
      }

      // تحديث مشروط لمنع الإنهاء المكرر
      const updated = await tx.visit.updateMany({
        where: {
          id: visitIdNumber,
          status: "IN_PROGRESS",
          ...(user.role === "ADMIN"
            ? {}
            : { userId: userIdNumber }),
        },
        data: {
          status: "COMPLETED",
          completedAt: new Date(),
          ...(notes !== undefined ? { notes } : {}),
        },
      });

      if (updated.count !== 1) {
        const error = new Error(
          "Visit has already been completed or cannot be updated"
        );
        error.status = 409;
        throw error;
      }

      return tx.visit.findUnique({
        where: { id: visitIdNumber },
        include: {
          customer: true,
          user: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
        },
      });
    });

    return Response.json({
      success: true,
      message: "Visit completed successfully",
      visit: result,
    });
  } catch (error) {
    console.error("VISITS_API_ERROR:", error);

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
        message: "Failed to process visits request",
      },
      { status: 500 }
    );
  }
}
