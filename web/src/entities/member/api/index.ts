/** Thành viên và nhóm trong chuyến — tầng dữ liệu dùng chung với mobile. */
export type { TripGroup, TripMember } from '@core/lib/data/trips';
export {
  addTripMember,
  createTripGroup,
  listTripGroups,
  listTripMembers,
  moveMemberToGroup,
  renameTripMember,
} from '@core/lib/data/trips';
