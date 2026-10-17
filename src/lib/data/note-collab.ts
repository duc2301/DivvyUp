/**
 * Truyền tải đồng soạn ghi chú qua Supabase Realtime — kênh PRIVATE theo từng
 * ghi chú (`trip-notes:<tripId>:<noteId>`).
 *
 * Quyền vào kênh do RLS trên realtime.messages quyết (migration
 * 20261017_1000_note_collab_realtime.sql): chỉ thành viên còn trong chuyến, ghi
 * chú và chuyến chưa xoá. Không có policy đó, private: true sẽ bị từ chối — đúng
 * hành vi mong muốn, không mở kênh public thay thế.
 *
 * Kiểu gói tin + kiểm dữ liệu không đáng tin nằm ở src/lib/notes/collab-protocol.ts.
 * Tên/màu người khác KHÔNG lấy từ gói tin — chỉ lấy memberId rồi tra danh sách
 * thành viên. GIỚI HẠN ĐÃ BIẾT: memberId trong presence do máy gửi tự khai
 * (broadcast không có danh tính phía máy chủ) — một thành viên CÙNG chuyến có
 * thể hiện con trỏ dưới tên người khác. Chỉ ảnh hưởng hiển thị, không mở quyền.
 *
 * Không đi qua manager.ts: chỉ dùng khi đã đăng nhập — chế độ khách không có
 * realtime (màn hình tự chọn luồng soạn cũ).
 */

import type {
  ChannelStatus,
  NoteChannel,
  NoteCollabEvent,
  PresencePeer,
} from '@/lib/notes/collab-protocol';
import { EVENT_TYPES, noteTopic, parseEvent, serializeEvent } from '@/lib/notes/collab-protocol';
import { supabase } from '@/lib/supabase/client';

// Lấy kiểu từ chính client (không import từ @supabase/supabase-js): web có bản
// supabase-js riêng, import theo tên trần sẽ ra hai kiểu kênh không khớp nhau.
type RealtimeChannel = ReturnType<typeof supabase.channel>;

export type { ChannelStatus, NoteChannel, NoteCollabEvent, PresencePeer };
export { noteTopic };

interface OpenOptions {
  readonly tripId: string;
  readonly noteId: string;
  readonly sessionKey: string;
  readonly memberId: string;
  readonly onEvent: (event: NoteCollabEvent) => void;
  readonly onPeers: (peers: readonly PresencePeer[]) => void;
  readonly onStatus: (status: ChannelStatus, message?: string) => void;
  /** Một gói không tới được máy chủ (quá hạn mức, rớt mạng, quá lớn) — phiên tự đồng bộ lại. */
  readonly onSendFailed: () => void;
}

function memberIdOf(metas: readonly unknown[]): string | null {
  const first = metas[0];
  if (typeof first !== 'object' || first === null) return null;
  const value = (first as Record<string, unknown>).memberId;
  return typeof value === 'string' && value.length <= 64 ? value : null;
}

export function openNoteChannel(options: OpenOptions): NoteChannel {
  const { onEvent, onPeers, onStatus, onSendFailed } = options;
  let channel: RealtimeChannel | null = null;
  // Chỉ gửi khi đã VÀO kênh: gửi lúc đang join/nối lại thì supabase-js âm thầm
  // chuyển sang REST — mỗi gói một HTTP POST, tốn data và quota.
  let joined = false;
  let closed = false;

  const start = async (): Promise<void> => {
    onStatus('connecting');
    // Kênh private xác thực bằng JWT của phiên — nạp token hiện tại trước khi join.
    await supabase.realtime.setAuth();
    // Phiên cũ của CHÍNH ghi chú này (vừa đóng màn, còn đang rời kênh): supabase-js
    // trả lại đúng kênh cũ cho cùng topic, subscribe() trên kênh đó không bao giờ
    // báo về — phiên mới kẹt "một mình". Gỡ hẳn kênh cũ trước.
    const topicName = `realtime:${noteTopic(options.tripId, options.noteId)}`;
    for (const stale of supabase.getChannels()) {
      if (stale.topic === topicName) await supabase.removeChannel(stale);
    }
    if (closed) return;
    const next = supabase.channel(noteTopic(options.tripId, options.noteId), {
      config: { private: true, broadcast: { self: false }, presence: { key: options.sessionKey } },
    });
    for (const name of EVENT_TYPES) {
      next.on('broadcast', { event: name }, (message: { payload?: unknown }) => {
        const parsed = parseEvent(name, message.payload);
        if (parsed) onEvent(parsed);
      });
    }
    next.on('presence', { event: 'sync' }, () => {
      const peers: PresencePeer[] = [];
      for (const [key, metas] of Object.entries(next.presenceState())) {
        if (key === options.sessionKey) continue;
        const memberId = memberIdOf(metas);
        if (memberId) peers.push({ key, memberId });
      }
      onPeers(peers);
    });
    next.subscribe((status, error) => {
      if (closed) return;
      if (status === 'SUBSCRIBED') {
        joined = true;
        onStatus('live');
        // Lỗi presence chỉ làm người khác không thấy mình trong thanh "đang
        // cùng sửa" — báo như gửi hỏng để phiên thử đồng bộ lại.
        next.track({ memberId: options.memberId }).then(
          (result) => {
            if (result !== 'ok' && !closed) onSendFailed();
          },
          () => {
            if (!closed) onSendFailed();
          },
        );
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        joined = false;
        // supabase-js tự thử nối lại; báo để màn hình hiện "đang sửa một mình".
        onStatus('error', error?.message);
      } else if (status === 'CLOSED') {
        joined = false;
        onStatus('connecting');
      }
    });
    channel = next;
  };

  start().catch((caught: unknown) => {
    if (!closed) onStatus('error', caught instanceof Error ? caught.message : String(caught));
  });

  return {
    send(event) {
      // Chưa vào kênh: bỏ — khi vào (lại), phiên gửi sync-request để bù phần thiếu.
      if (!channel || !joined || closed) return;
      const payload = serializeEvent(event);
      if (!payload) {
        onSendFailed();
        return;
      }
      channel.send({ type: 'broadcast', event: event.type, payload }).then(
        (result) => {
          if (result !== 'ok' && !closed) onSendFailed();
        },
        () => {
          if (!closed) onSendFailed();
        },
      );
    },
    close() {
      closed = true;
      joined = false;
      // Rời kênh hỏng chỉ để rò một kết nối tạm — không có dữ liệu nào phụ thuộc.
      if (channel) void supabase.removeChannel(channel);
      channel = null;
    },
  };
}
