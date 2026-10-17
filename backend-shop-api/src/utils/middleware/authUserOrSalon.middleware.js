// utils/middleware/authUserOrSalon.middleware.js
//
// One guard for the marketplace catalog
// (POST /api/products/get-all-salons-products-list): the mobile app calls it
// with a USER token, while the web shop calls it with a SALON token (the salon
// portal has no user login). Either claim is accepted and the request is
// populated the same way each dedicated middleware would populate it
// (request.user / request.salon), so controllers keep reading one shape or
// the other.
const db = require('../../database/models');
const userService = require('../../services/user.service');
const { verifyToken } = require('./token.util');

const authenticateUserOrSalon = async (request, response, next) => {
  try {
    let token;
    if (
      request.headers.authorization &&
      request.headers.authorization.startsWith('Bearer ')
    ) {
      token = request.headers.authorization.split(' ')[1];
    }

    if (!token) {
      return response.status(401).json({
        status: 'JWT_FAILED',
        message: 'Access token required'
      });
    }

    let decoded;
    try {
      decoded = verifyToken(token);
    } catch (error) {
      return response.status(401).json({
        status: 'JWT_FAILED',
        message: 'Invalid token'
      });
    }

    if (!decoded) {
      return response.status(401).json({
        status: 'JWT_FAILED',
        message: 'Invalid token payload'
      });
    }

    // Customer token (mobile app)
    if (decoded.userId) {
      const user = await userService.getUserById(decoded.userId);
      if (!user) {
        return response.status(401).json({
          status: 'JWT_FAILED',
          message: 'User not found'
        });
      }
      if (!user.isActive) {
        return response.status(403).json({
          status: 'JWT_FAILED',
          message: 'User is not active. Please contact support.'
        });
      }
      request.user = {
        id: user.userId,
        phoneNumber: user.phoneNumber
      };
      request.name = user?.fullName;
      return next();
    }

    // Salon token (web shop)
    if (decoded.salonId) {
      const salon = await db.Salon.findOne({
        where: { salonId: decoded.salonId, isActive: true, deletedAt: null }
      });
      if (!salon) {
        return response.status(401).json({
          status: 'JWT_FAILED',
          message: 'Not authorized, invalid salon token'
        });
      }
      request.salon = salon;
      return next();
    }

    return response.status(401).json({
      status: 'JWT_FAILED',
      message: 'Invalid token payload'
    });
  } catch (error) {
    console.log('ERROR:', error.message);
    return response.status(401).json({
      status: 'JWT_FAILED',
      message: 'Not authorized'
    });
  }
};

module.exports = authenticateUserOrSalon;
