/**
 * Public delivery-fee surface — constants + period helpers + model predict/fit.
 * Full OLS/range logic lives in `delivery-fee-model.ts` (port of legacy).
 */
export {
  FEE_STEP_UGX,
  TIGHT_RANGE_HALF_UGX,
  WIDE_RANGE_HALF_UGX,
  MAX_RANGE_WIDTH_UGX,
  MIN_FARE_UGX,
  RANGE_BANDS_KM,
  PERIODS,
  kampalaHour,
  periodForHour,
  periodForDate,
  roundFeeToNearest500,
  roundFeeDown500,
  roundFeeUp500,
  periodMeta,
  listPeriods,
  fitDeliveryFeeModel,
  fitDeliveryFeeModel as fitFeeModel,
  estimateDurationMin,
  rawQuoteFee,
  quoteFee,
  quoteFeeRange,
  predictSafeBodaFee,
  predictSafeBodaFeeRange,
  modelConfidence,
  formatPremiumVsDay,
} from './delivery-fee-model';
