import { useState } from 'react';
import type { TextLayoutEventData } from 'react-native';
import { Text, View } from 'react-native';

import type { PeerCursor } from '@/lib/notes/collab-session';

/**
 * Lớp vẽ con trỏ người khác đè lên ô nội dung (React Native).
 *
 * React Native không cho hỏi "ký tự thứ N nằm ở toạ độ nào" trong TextInput. Cách
 * làm: với mỗi con trỏ, dựng một <Text> ẩn cùng font/cỡ chữ/độ rộng với ô nhập,
 * chứa đúng phần chữ TRƯỚC con trỏ; onTextLayout cho dòng cuối → (x, y) của con
 * trỏ. TextInput và Text dàn chữ gần như giống nhau, nên vị trí GẦN ĐÚNG (người
 * dùng đã chấp nhận); web (web/) vẽ chính xác bằng kỹ thuật div soi gương.
 *
 * Lớp phủ pointerEvents="none" (không chặn chạm) và ẩn khỏi trình đọc màn hình
 * ở cả Android (importantForAccessibility) lẫn iOS (accessibilityElementsHidden)
 * — không thì VoiceOver đọc lại phần chữ dùng để đo.
 */

/** Tên lớp màu viết LIỀN chữ để Tailwind giữ lại khi build (không ghép chuỗi). */
const CURSOR_BG = ['bg-cursor-0', 'bg-cursor-1', 'bg-cursor-2', 'bg-cursor-3', 'bg-cursor-4', 'bg-cursor-5'];

/** Nhãn tên ước chừng rộng ngần này — gần mép phải thì lật nhãn sang trái con trỏ. */
const LABEL_ROOM = 96;

interface Caret {
  readonly x: number;
  readonly y: number;
  readonly height: number;
}

interface RemoteCursorsProps {
  readonly body: string;
  readonly cursors: readonly PeerCursor[];
  readonly nameOf: (memberId: string) => string;
  /** Bề rộng vùng chữ bên trong ô nhập (đã trừ padding). */
  readonly textWidth: number;
  /** Lớp chữ PHẢI trùng ô nhập: cỡ chữ, chiều cao dòng. */
  readonly textClassName: string;
  /** Khoảng cách từ mép ô nhập tới chữ (padding + viền). */
  readonly inset: number;
}

export function RemoteCursors({ body, cursors, nameOf, textWidth, textClassName, inset }: RemoteCursorsProps) {
  const [carets, setCarets] = useState<ReadonlyMap<string, Caret>>(new Map());
  if (textWidth <= 0) return null;

  const onMeasure = (key: string, caret: Caret): void => {
    setCarets((current) => {
      const previous = current.get(key);
      if (previous && previous.x === caret.x && previous.y === caret.y && previous.height === caret.height) {
        return current;
      }
      const next = new Map(current);
      next.set(key, caret);
      return next;
    });
  };

  const visible = cursors.filter((cursor) => cursor.head !== null);

  return (
    <View
      pointerEvents="none"
      className="absolute inset-0"
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden>
      {visible.map((cursor) => {
        const caret = carets.get(cursor.key);
        const color = CURSOR_BG[cursor.slot] ?? CURSOR_BG[0];
        const height = caret?.height || 20;
        const flip = caret ? caret.x > textWidth - LABEL_ROOM : false;
        return (
          <View key={cursor.key}>
            <CaretProbe
              cursorKey={cursor.key}
              text={body.slice(0, cursor.head ?? 0)}
              width={textWidth}
              inset={inset}
              className={textClassName}
              onMeasure={onMeasure}
            />
            {caret ? (
              <View style={{ left: inset + caret.x - 1, top: inset + caret.y }} className="absolute">
                <View style={{ height }} className={`w-0.5 ${color}`} />
                <View
                  style={{ bottom: height - 1 }}
                  className={`absolute rounded-md px-1.5 py-0.5 ${
                    flip ? 'right-0 rounded-br-none' : 'left-0 rounded-bl-none'
                  } ${color}`}>
                  <Text numberOfLines={1} className="text-xs font-semibold text-cursor-foreground">
                    {nameOf(cursor.memberId)}
                  </Text>
                </View>
              </View>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

interface CaretProbeProps {
  readonly cursorKey: string;
  /** Chữ trước con trỏ. */
  readonly text: string;
  readonly width: number;
  readonly inset: number;
  readonly className: string;
  readonly onMeasure: (key: string, caret: Caret) => void;
}

/**
 * Ô chữ ẩn đo vị trí một con trỏ. Tách thành component riêng để React Compiler
 * giữ nguyên khi phần chữ TRƯỚC con trỏ không đổi — người khác (hay chính mình)
 * gõ phía sau thì không phải dàn lại tới 10.000 ký tự mỗi phím.
 */
function CaretProbe({ cursorKey, text, width, inset, className, onMeasure }: CaretProbeProps) {
  const measure = (event: { nativeEvent: TextLayoutEventData }): void => {
    const lines = event.nativeEvent.lines;
    const last = lines[lines.length - 1];
    onMeasure(cursorKey, last ? { x: last.x + last.width, y: last.y, height: last.height } : { x: 0, y: 0, height: 0 });
  };
  return (
    // Ký tự rộng 0 cuối giữ dòng cuối kể cả khi chữ kết thúc bằng xuống dòng.
    <Text
      onTextLayout={measure}
      style={{ left: inset, top: inset, width }}
      className={`absolute opacity-0 ${className}`}>
      {text}
      {'​'}
    </Text>
  );
}
