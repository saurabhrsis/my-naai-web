const db = require('../../database/models');
const { verifyToken } = require('./token.util');

/**
 * Authenticates a token that belongs to EITHER a distributor (JWT claim
 * `distributorId`, from /api/distributors/login) OR the company admin (JWT
 * claim `adminId`, from /api/admin/login). The loaded entity is attached as
 * `request.distributor` / `request.admin`.
 *
 * The accept/reject endpoints use this because the company admin may record
 * a distributor's decision on their behalf (a phone call away).
 */
const authenticateDistributorOrAdmin = async (request, response, next) => {
    try {
        let token;
        if (request.headers.authorization && request.headers.authorization.startsWith('Bearer ')) {
            token = request.headers.authorization.split(' ')[1];
        }
        if (!token) {
            return response.status(401).json({ status: 'JWT_FAILED', message: 'Not authorized, no token provided' });
        }

        const decoded = verifyToken(token);
        if (!decoded || (!decoded.distributorId && !decoded.adminId)) {
            return response.status(401).json({ status: 'JWT_FAILED', message: 'Invalid token payload' });
        }

        if (decoded.distributorId) {
            const distributor = await db.Distributor.findOne({
                where: { distributorId: decoded.distributorId, isActive: true }
            });
            if (!distributor) {
                return response.status(401).json({ status: 'JWT_FAILED', message: 'Not authorized, invalid distributor token' });
            }
            request.distributor = distributor;
            return next();
        }

        const admin = await db.Admin.findByPk(decoded.adminId, { attributes: { exclude: ['password'] } });
        if (!admin || !admin.isActive) {
            return response.status(401).json({ status: 'JWT_FAILED', message: 'Not authorized, invalid admin token' });
        }
        request.admin = admin;
        return next();
    } catch (error) {
        return response.status(401).json({ status: 'JWT_FAILED', message: 'Not authorized, invalid token' });
    }
};

module.exports = { authenticateDistributorOrAdmin };
