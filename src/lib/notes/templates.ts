/**
 * Nội dung gợi ý cho từng mẫu ghi chú. Thuần TypeScript, không import React
 * Native, để bản web dùng lại đúng bộ mẫu này.
 *
 * Bộ giá trị `key` hợp lệ có MỘT nguồn: NOTE_TEMPLATE_KEYS ở tầng dữ liệu
 * (khớp CHECK của cột trip_notes.template). File này chỉ gắn nhãn và nội dung.
 */

import type { NoteTemplateKey } from '../data/notes.ts';

export interface NotePreset {
  readonly key: NoteTemplateKey | null;
  readonly label: string;
  readonly emoji: string;
  readonly title: string;
  readonly body: string;
}

export const NOTE_PRESETS: readonly NotePreset[] = [
  {
    key: null,
    label: 'Ghi chú trống',
    emoji: '📝',
    title: '',
    body: '',
  },
  {
    key: 'plan',
    label: 'Kế hoạch chuyến đi',
    emoji: '🗺️',
    title: 'Kế hoạch chuyến đi',
    body: [
      'Ngày 1:',
      '- Sáng: ',
      '- Trưa: ',
      '- Tối: ',
      '',
      'Ngày 2:',
      '- Sáng: ',
      '- Trưa: ',
      '- Tối: ',
      '',
      'Chỗ ở: ',
      'Di chuyển: ',
    ].join('\n'),
  },
  {
    key: 'notes',
    label: 'Lưu ý',
    emoji: '⚠️',
    title: 'Lưu ý',
    body: [
      'Giấy tờ: CCCD, bằng lái, vé',
      'Đồ cần mang: ',
      'Giờ tập trung: ',
      'Số điện thoại liên lạc: ',
      'Quỹ chung / ai giữ tiền: ',
    ].join('\n'),
  },
  {
    key: 'description',
    label: 'Miêu tả',
    emoji: '✨',
    title: 'Về chuyến đi',
    body: 'Chuyến đi này là dịp để ',
  },
];

export function presetOf(key: NoteTemplateKey | null): NotePreset {
  return NOTE_PRESETS.find((preset) => preset.key === key) ?? NOTE_PRESETS[0];
}
