const { Op } = require('sequelize');
const db = require('../database/models');
const DEFAULT_LIMIT = parseInt(process.env.PAGE_LIMIT) || 20;

/**
 * Distributor management (company admin). A distributor is a delivery
 * partner the admin assigns shop orders to; the internal status track is
 * visible per distributor on the admin side.
 */
const list = async ({ page = 1, searchString = '' } = {}) => {
  const limit = DEFAULT_LIMIT;
  const safePage = parseInt(page, 10) > 0 ? parseInt(page, 10) : 1;
  const offset = (safePage - 1) * limit;

  const where = {};
  const trimmedSearch = String(searchString || '').trim();
  if (trimmedSearch) {
    where[Op.or] = [
      { name: { [Op.iLike]: `%${trimmedSearch}%` } },
      { phone: { [Op.iLike]: `%${trimmedSearch}%` } },
      { area: { [Op.iLike]: `%${trimmedSearch}%` } }
    ];
  }

  const { count: totalDistributors, rows: distributors } = await db.Distributor.findAndCountAll({
    where,
    order: [['name', 'ASC']],
    limit,
    offset
  });

  return {
    distributors,
    pagination: { page: safePage, limit, totalDistributors, totalPages: Math.ceil(totalDistributors / limit) || 0 }
  };
};

const getById = async (distributorId) => db.Distributor.findByPk(distributorId);

const create = async (dataToInsert) => db.Distributor.create(dataToInsert);

const update = async (distributorId, dataToUpdate) => {
  const distributor = await db.Distributor.findByPk(distributorId);
  if (!distributor) return null;
  await distributor.update(dataToUpdate);
  return distributor;
};

module.exports = { list, getById, create, update };
