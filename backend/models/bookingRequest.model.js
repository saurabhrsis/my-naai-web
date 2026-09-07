'use strict';

const mongoose = require('mongoose');

/**
 * Fields the time-change feature needs on a booking request.
 *
 * MERGE these into your existing BookingRequest schema rather than replacing
 * it — the block at the top mirrors fields you already have (they are shown so
 * the controller reads unambiguously), and the block below `--- time change ---`
 * is what is genuinely new.
 */

const TIME_CHANGE_STATUS = ['NONE', 'PENDING', 'ACCEPTED', 'REJECTED', 'EXPIRED'];

// One row per proposal or response. Kept because "you told me seven o'clock"
// is an argument that needs an answer, and because a salon repeatedly pushing
// customers back is something you will eventually want to see.
const timeChangeHistorySchema = new mongoose.Schema(
  {
    event: { type: String, enum: ['PROPOSED', 'ACCEPTED', 'REJECTED', 'EXPIRED'], required: true },
    delayMinutes: { type: Number },          // signed: + later, - earlier
    direction: { type: String, enum: ['LATER', 'EARLIER'] },
    fromBookingDate: { type: String },
    fromBookingTime: { type: String },
    toBookingDate: { type: String },
    toBookingTime: { type: String },
    reason: { type: String, trim: true, maxlength: 200 },
    actorRole: { type: String, enum: ['SALON', 'CUSTOMER', 'SYSTEM'] },
    actorId: { type: mongoose.Schema.Types.ObjectId },
    at: { type: Date, default: Date.now },
  },
  { _id: false },
);

const bookingRequestSchema = new mongoose.Schema(
  {
    // ----- existing fields (shown for context; keep yours) -----
    bookingId: { type: mongoose.Schema.Types.ObjectId, ref: 'Booking' },
    salonId: { type: mongoose.Schema.Types.ObjectId, ref: 'Salon', required: true, index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    userName: { type: String, trim: true },
    barberName: { type: String, trim: true },
    serviceNames: { type: String, trim: true },
    queueNumber: { type: Number },

    // Wall-clock strings, never UTC Dates. See lib/bookingClock.js.
    bookingDate: { type: String },                    // 'YYYY-MM-DD'
    bookingTime: { type: String },                    // 'HH:mm:ss'
    startTime: { type: String },
    endTime: { type: String },

    status: {
      type: String,
      enum: ['PENDING', 'ACCEPTED', 'REJECTED', 'CANCELLED', 'COMPLETED', 'DELAY_REQUESTED'],
      default: 'PENDING',
      index: true,
    },

    // ----- time change -----

    // The time the salon is asking for. NOT the booked time — that only moves
    // once the customer accepts, so a customer who never replies still has the
    // slot they originally agreed to.
    proposedBookingDate: { type: String, default: '' },
    proposedBookingTime: { type: String, default: '' },

    // Signed minutes: positive = later, negative = earlier. A single signed
    // number instead of a flag plus a magnitude means no combination of the two
    // can ever contradict itself.
    delayMinutes: { type: Number, default: 0 },

    timeChangeReason: { type: String, trim: true, maxlength: 200, default: '' },

    timeChangeStatus: { type: String, enum: TIME_CHANGE_STATUS, default: 'NONE', index: true },

    timeChangeRequestedAt: { type: Date, default: null },
    timeChangeRespondedAt: { type: Date, default: null },

    // Guards against a duplicate tap sending two notifications: the controller
    // rejects a second proposal that matches the pending one.
    timeChangeHistory: { type: [timeChangeHistorySchema], default: [] },
  },
  { timestamps: true },
);

// The customer's "do I have a pending time change?" lookup.
bookingRequestSchema.index({ userId: 1, timeChangeStatus: 1 });

// Convenience for the controller: is this booking in a state where its time may
// still be moved? Completed, cancelled and rejected bookings are not — notifying
// a customer about an appointment they already walked out of is worse than
// doing nothing.
bookingRequestSchema.methods.canChangeTime = function canChangeTime() {
  return ['PENDING', 'ACCEPTED', 'DELAY_REQUESTED'].includes(this.status);
};

module.exports =
  mongoose.models.BookingRequest || mongoose.model('BookingRequest', bookingRequestSchema);
module.exports.TIME_CHANGE_STATUS = TIME_CHANGE_STATUS;
