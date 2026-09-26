/**
 * Ghi chú chuyến đi — tầng dữ liệu dùng chung với mobile.
 *
 * updateTripNote(noteId, input, expectedUpdatedAt): truyền `updatedAt` của ghi
 * chú LÚC MỞ; người khác đã sửa trong lúc đó thì máy chủ từ chối (NOTE_STALE_MESSAGE)
 * thay vì ghi đè im lặng.
 */
export type { NoteTemplateKey, TripNote } from '@core/lib/data/notes';
export {
  createTripNote,
  deleteTripNote,
  listTripNotes,
  NOTE_BODY_MAX,
  NOTE_STALE_MESSAGE,
  NOTE_TEMPLATE_KEYS,
  NOTE_TITLE_MAX,
  updateTripNote,
} from '@core/lib/data/notes';

export type { NotePreset } from '@core/lib/notes/templates';
export { NOTE_PRESETS, presetOf } from '@core/lib/notes/templates';
