
import { prisma } from "../../../src/lib/prisma";
import { verifyAuth } from "../../../src/lib/auth";

// GET /api/tracking
// الأدمن يشوف كل نقاط التتبع، والمندوب يشوف نقاطه فقط
export async function GET(request) {
  try {
    const auth = verifyAuth(request);

    if (!auth.success) {
      return Response.json(
        { success: false, message: auth.message },
        { status: auth.status }
      );
    }

    const userId = Number(auth.user.id);

    const user = await prisma.user.findUnique({
      where: { id: userId },
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

    const { searchParams } = new URL(request.url);
    const requestedUserId = searchParams.get("userId");

    let where = {};

    if (user.role !== "ADMIN") {
      // المندوب لا يمكنه رؤية مواقع الآخرين
      where.userId = userId;
    } else if (requestedUserId !== null) {
      const parsedUserId = Number(requestedUserId);

      if (
        !Number.isInteger(parsedUserId) ||
        parsedUserId <= 0
      ) {
        return Response.json(
          { success: false, message: "Invalid userId" },
          { status: 400 }
        );
      }

      where.userId = parsedUserId;
    }

    const points = await prisma.trackingPoint.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 500,
      include: {
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
      count: points.length,
      points,
    });
  } catch (error) {
    console.error("GET_TRACKING_ERROR:", error);

    return Response.json(
      {
        success: false,
        message: "Failed to fetch tracking points",
      },
      { status: 500 }
    );
  }
}

// POST /api/tracking
// تسجيل موقع المندوب الحالي
export async function POST(request) {
  try {
    const auth = verifyAuth(request);

    if (!auth.success) {
      return Response.json(
        { success: false, message: auth.message },
        { status: auth.status }
      );
    }

    const userId = Number(auth.user.id);

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, isActive: true },
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

    const body = await request.json();
    const { latitude, longitude, accuracy } = body;

    const lat = Number(latitude);
    const lng = Number(longitude);

    if (
      latitude === undefined ||
      latitude === null ||
      latitude === "" ||
      longitude === undefined ||
      longitude === null ||
      longitude === "" ||
      !Number.isFinite(lat) ||
      lat < -90 ||
      lat > 90 ||
      !Number.isFinite(lng) ||
      lng < -180 ||
      lng > 180
    ) {
      return Response.json(
        {
          success: false,
          message: "Valid latitude and longitude are required",
        },
        { status: 400 }
      );
    }

    let parsedAccuracy = null;

    if (accuracy !== undefined && accuracy !== null) {
      parsedAccuracy = Number(accuracy);

      if (
        !Number.isFinite(parsedAccuracy) ||
        parsedAccuracy < 0
      ) {
        return Response.json(
          {
            success: false,
            message: "Accuracy must be a non-negative number",
          },
          { status: 400 }
        );
      }
    }

    // userId يؤخذ من JWT، ولا يقبل من الـ body
    const point = await prisma.trackingPoint.create({
      data: {
        userId,
        latitude: lat,
        longitude: lng,
        accuracy: parsedAccuracy,
      },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    });

    return Response.json(
      {
        success: true,
        message: "Location recorded successfully",
        point,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("POST_TRACKING_ERROR:", error);

    return Response.json(
      {
        success: false,
        message: "Failed to record location",
      },
      { status: 500 }
    );
  }
}
