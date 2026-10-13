
import { prisma } from "../../../src/lib/prisma";
import { verifyAuth } from "../../../src/lib/auth";

// GET /api/notifications
// Admin sees all notifications; sales reps see their own only.
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

    const currentUser = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        role: true,
        isActive: true,
      },
    });

    if (!currentUser || !currentUser.isActive) {
      return Response.json(
        {
          success: false,
          message: "User not found or account is inactive",
        },
        { status: 403 }
      );
    }

    const notifications = await prisma.notification.findMany({
      where:
        currentUser.role === "ADMIN"
          ? {}
          : { userId: currentUser.id },
      orderBy: { createdAt: "desc" },
    });

    return Response.json({
      success: true,
      count: notifications.length,
      notifications,
    });
  } catch (error) {
    console.error("GET_NOTIFICATIONS_ERROR:", error);

    return Response.json(
      {
        success: false,
        message: "Failed to fetch notifications",
      },
      { status: 500 }
    );
  }
}

// POST /api/notifications
// Admin only: create a notification for a specific user.
export async function POST(request) {
  try {
    const auth = verifyAuth(request);

    if (!auth.success) {
      return Response.json(
        { success: false, message: auth.message },
        { status: auth.status }
      );
    }

    const adminId = Number(auth.user.id);

    const admin = await prisma.user.findUnique({
      where: { id: adminId },
      select: {
        id: true,
        role: true,
        isActive: true,
      },
    });

    if (!admin || !admin.isActive) {
      return Response.json(
        {
          success: false,
          message: "User not found or account is inactive",
        },
        { status: 403 }
      );
    }

    if (admin.role !== "ADMIN") {
      return Response.json(
        {
          success: false,
          message: "Only administrators can create notifications",
        },
        { status: 403 }
      );
    }

    let body;

    try {
      body = await request.json();
    } catch {
      return Response.json(
        {
          success: false,
          message: "Request body must be valid JSON",
        },
        { status: 400 }
      );
    }

    const { userId, title, message, type } = body;

    const allowedTypes = ["INFO", "WARNING", "SUCCESS"];

    if (
      !Number.isInteger(userId) ||
      userId <= 0 ||
      typeof title !== "string" ||
      !title.trim() ||
      typeof message !== "string" ||
      !message.trim() ||
      (type !== undefined && !allowedTypes.includes(type))
    ) {
      return Response.json(
        {
          success: false,
          message:
            "Valid userId, title, message and notification type are required. Allowed types: INFO, WARNING, SUCCESS",
        },
        { status: 400 }
      );
    }

    const targetUser = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });

    if (!targetUser) {
      return Response.json(
        {
          success: false,
          message: "Target user not found",
        },
        { status: 404 }
      );
    }

    const notification = await prisma.notification.create({
      data: {
        userId: targetUser.id,
        title: title.trim(),
        message: message.trim(),
        type: type || "INFO",
      },
    });

    return Response.json(
      {
        success: true,
        message: "Notification created successfully",
        notification,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("CREATE_NOTIFICATION_ERROR:", error);

    return Response.json(
      {
        success: false,
        message: "Failed to create notification",
      },
      { status: 500 }
    );
  }
}

// PATCH /api/notifications
// Mark a notification as read.
export async function PATCH(request) {
  try {
    const auth = verifyAuth(request);

    if (!auth.success) {
      return Response.json(
        { success: false, message: auth.message },
        { status: auth.status }
      );
    }

    const userId = Number(auth.user.id);

    const currentUser = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        role: true,
        isActive: true,
      },
    });

    if (!currentUser || !currentUser.isActive) {
      return Response.json(
        {
          success: false,
          message: "User not found or account is inactive",
        },
        { status: 403 }
      );
    }

    let body;

    try {
      body = await request.json();
    } catch {
      return Response.json(
        {
          success: false,
          message: "Request body must be valid JSON",
        },
        { status: 400 }
      );
    }

    const notificationId = Number(body.notificationId);

    if (
      !Number.isInteger(notificationId) ||
      notificationId <= 0
    ) {
      return Response.json(
        {
          success: false,
          message: "Valid notificationId is required",
        },
        { status: 400 }
      );
    }

    const notification = await prisma.notification.findUnique({
      where: { id: notificationId },
    });

    if (!notification) {
      return Response.json(
        {
          success: false,
          message: "Notification not found",
        },
        { status: 404 }
      );
    }

    // Sales reps can update their own notifications only.
    // Admins can update any notification.
    if (
      currentUser.role !== "ADMIN" &&
      notification.userId !== currentUser.id
    ) {
      return Response.json(
        {
          success: false,
          message: "You cannot update this notification",
        },
        { status: 403 }
      );
    }

    const updatedNotification = await prisma.notification.update({
      where: { id: notificationId },
      data: { isRead: true },
    });

    return Response.json({
      success: true,
      message: "Notification marked as read",
      notification: updatedNotification,
    });
  } catch (error) {
    console.error("MARK_NOTIFICATION_READ_ERROR:", error);

    return Response.json(
      {
        success: false,
        message: "Failed to update notification",
      },
      { status: 500 }
    );
  }
}
