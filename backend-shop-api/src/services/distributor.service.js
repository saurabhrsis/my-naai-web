const { Op } = require('sequelize');
const bcrypt = require('bcryptjs');
const db = require('../database/models');
const DEFAULT_LIMIT = parseInt(process.env.PAGE_LIMIT) || 20;

/**
 * Distributor management (company admin) + portal login. A distributor is a
 * delivery partner the admin requests for shop orders; the distributor logs
 * in with the password the admin set and accepts or rejects their orders.
 * The `password` hash is never returned to any client.
 */
const publicView = (distributor) => {
  if (!distributor) return null;
  const view = distributor.toJSON ? distributor.toJSON() : { ...distributor };
  delete view.password;
  return view;
};

const hashPassword = (plain) => (plain ? bcrypt.hashSync(plain, 10) : null);

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
    distributors: distributors.map(publicView),
    pagination: { page: safePage, limit, totalDistributors, totalPages: Math.ceil(totalDistributors / limit) || 0 }
  };
};

const getById = async (distributorId) => db.Distributor.findByPk(distributorId);

const create = async (dataToInsert) => {
  const data = { ...dataToInsert };
  if (data.password) data.password = hashPassword(data.password);
  return publicView(await db.Distributor.create(data));
};

const update = async (distributorId, dataToUpdate) => {
  const distributor = await db.Distributor.findByPk(distributorId);
  if (!distributor) return null;
  const data = { ...dataToUpdate };
  if (data.password !== undefined) data.password = data.password ? hashPassword(data.password) : null;
  await distributor.update(data);
  return publicView(distributor);
};

// Portal login: phone or email + the password the admin set.
const login = async (identifier, password) => {
  const trimmed = String(identifier || '').trim();
  const distributor = await db.Distributor.findOne({
    where: {
      [Op.or]: [
        { phone: trimmed },
        { email: { [Op.iLike]: trimmed } }
      ],
      isActive: true
    }
  });
  if (!distributor || !distributor.password) return null;
  const ok = await bcrypt.compare(password, distributor.password);
  return ok ? publicView(distributor) : null;
};

module.exports = { list, getById, create, update, login };
