/**
 * Kiểu dữ liệu phản chiếu schema trong supabase/migrations/.
 *
 * Viết tay để khớp đúng 4 migration hiện có. Khi schema đổi, sinh lại bằng:
 *   npx supabase gen types typescript --project-id <ref> > src/lib/supabase/database.types.ts
 *
 * HAI RÀNG BUỘC CỦA supabase-js, sai là mọi truy vấn suy ra kiểu `never`:
 *  1. Mỗi Table và View PHẢI có mảng `Relationships`, kể cả khi rỗng.
 *  2. `Insert`/`Update` phải là object type, không được là `never` — nó phá
 *     ràng buộc Record<string, unknown>. Bảng cấm ghi thì dùng
 *     Record<string, never>: vẫn thoả ràng buộc, mà mọi lệnh insert vẫn bị
 *     TypeScript chặn ngay lúc gõ.
 *
 * Về bigint: PostgREST trả cột bigint dưới dạng số JSON. Mọi giá trị *_minor
 * phải đi qua toSafeMinor() trước khi dùng — số vượt ngưỡng an toàn của
 * JavaScript sẽ mất chính xác mà không báo lỗi.
 */

/** Một phần tử trong cột jsonb trips.cover_images. */
export interface CoverImageRow {
  url: string;
  thumbUrl: string;
  credit: string | null;
  link: string | null;
  provider: string | null;
}

export type TripRole = 'owner' | 'member';
export type SplitModeDb = 'equal' | 'exact';

/** Bảng chỉ cho đọc: ghi phải đi qua RPC. */
type ReadOnly = Record<string, never>;

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          display_name: string;
          avatar_url: string | null;
          /** Đường dẫn trong bucket `avatars`, luôn bắt đầu bằng `<id>/`. */
          avatar_path: string | null;
          /** Đường dẫn trong bucket riêng tư `payment-qr`. */
          payment_qr_path: string | null;
          payment_note: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: { id: string; display_name: string; avatar_url?: string | null };
        Update: {
          display_name?: string;
          avatar_url?: string | null;
          avatar_path?: string | null;
          payment_qr_path?: string | null;
          payment_note?: string | null;
        };
        Relationships: [];
      };

      trips: {
        Row: {
          id: string;
          name: string;
          currency: string;
          start_date: string | null;
          end_date: string | null;
          join_code: string;
          created_by: string;
          created_at: string;
          updated_at: string;
          deleted_at: string | null;
          // Điểm đến, lấy từ Mapbox qua Edge Function place-search.
          place_name: string | null;
          place_address: string | null;
          place_country: string | null;
          latitude: number | null;
          longitude: number | null;
          place_provider: string | null;
          place_external_id: string | null;
          cover_images: CoverImageRow[];
          cover_image_index: number;
        };
        Insert: {
          id?: string;
          name: string;
          currency: string;
          start_date?: string | null;
          end_date?: string | null;
          created_by: string;
          place_name?: string | null;
          place_address?: string | null;
          place_country?: string | null;
          latitude?: number | null;
          longitude?: number | null;
          place_provider?: string | null;
          place_external_id?: string | null;
          cover_images?: CoverImageRow[];
          cover_image_index?: number;
        };
        Update: {
          name?: string;
          start_date?: string | null;
          end_date?: string | null;
          deleted_at?: string | null;
          place_name?: string | null;
          place_address?: string | null;
          place_country?: string | null;
          latitude?: number | null;
          longitude?: number | null;
          place_provider?: string | null;
          place_external_id?: string | null;
          cover_images?: CoverImageRow[];
          cover_image_index?: number;
        };
        Relationships: [
          {
            foreignKeyName: 'trips_created_by_fkey';
            columns: ['created_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };

      trip_groups: {
        Row: {
          id: string;
          trip_id: string;
          name: string;
          sort_order: number;
          created_at: string;
          deleted_at: string | null;
        };
        Insert: { id?: string; trip_id: string; name: string; sort_order?: number };
        Update: { name?: string; sort_order?: number; deleted_at?: string | null };
        Relationships: [
          {
            foreignKeyName: 'trip_groups_trip_id_fkey';
            columns: ['trip_id'];
            isOneToOne: false;
            referencedRelation: 'trips';
            referencedColumns: ['id'];
          },
        ];
      };

      trip_members: {
        Row: {
          id: string;
          trip_id: string;
          group_id: string | null;
          display_name: string;
          /** null = mới chỉ là cái tên, chưa gắn tài khoản. */
          user_id: string | null;
          role: TripRole;
          sort_order: number;
          created_at: string;
          removed_at: string | null;
        };
        // user_id cố ý vắng mặt: gắn tài khoản chỉ qua RPC join_trip_by_code(),
        // trigger protect_trip_member_identity chặn mọi đường khác.
        Insert: {
          id?: string;
          trip_id: string;
          group_id?: string | null;
          display_name: string;
          sort_order?: number;
        };
        Update: {
          group_id?: string | null;
          display_name?: string;
          role?: TripRole;
          sort_order?: number;
          removed_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'trip_members_trip_id_fkey';
            columns: ['trip_id'];
            isOneToOne: false;
            referencedRelation: 'trips';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'trip_members_group_same_trip_fkey';
            columns: ['group_id', 'trip_id'];
            isOneToOne: false;
            referencedRelation: 'trip_groups';
            referencedColumns: ['id', 'trip_id'];
          },
          {
            foreignKeyName: 'trip_members_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };

      expenses: {
        Row: {
          id: string;
          trip_id: string;
          currency: string;
          description: string;
          amount_minor: number;
          paid_by: string;
          split_mode: SplitModeDb;
          paid_at: string;
          created_by: string;
          created_at: string;
          updated_at: string;
          deleted_at: string | null;
          /** Khác null = "đã xong", không tính vào số dư. Đổi qua RPC set_expense_settled. */
          settled_at: string | null;
          settled_by: string | null;
        };
        // Không có policy INSERT: tạo khoản chi phải qua RPC create_expense().
        Insert: ReadOnly;
        Update: { deleted_at?: string | null };
        Relationships: [
          {
            foreignKeyName: 'expenses_trip_currency_fkey';
            columns: ['trip_id', 'currency'];
            isOneToOne: false;
            referencedRelation: 'trips';
            referencedColumns: ['id', 'currency'];
          },
          {
            foreignKeyName: 'expenses_paid_by_fkey';
            columns: ['paid_by'];
            isOneToOne: false;
            referencedRelation: 'trip_members';
            referencedColumns: ['id'];
          },
        ];
      };

      expense_shares: {
        Row: { expense_id: string; member_id: string; amount_minor: number };
        Insert: ReadOnly;
        Update: ReadOnly;
        Relationships: [
          {
            foreignKeyName: 'expense_shares_expense_id_fkey';
            columns: ['expense_id'];
            isOneToOne: false;
            referencedRelation: 'expenses';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'expense_shares_member_id_fkey';
            columns: ['member_id'];
            isOneToOne: false;
            referencedRelation: 'trip_members';
            referencedColumns: ['id'];
          },
        ];
      };

      settlements: {
        Row: {
          id: string;
          trip_id: string;
          currency: string;
          from_member: string;
          to_member: string;
          amount_minor: number;
          settled_at: string;
          note: string | null;
          created_by: string;
          created_at: string;
          deleted_at: string | null;
        };
        Insert: {
          id?: string;
          trip_id: string;
          currency: string;
          from_member: string;
          to_member: string;
          amount_minor: number;
          settled_at?: string;
          note?: string | null;
          created_by: string;
        };
        Update: { note?: string | null; deleted_at?: string | null };
        Relationships: [
          {
            foreignKeyName: 'settlements_trip_currency_fkey';
            columns: ['trip_id', 'currency'];
            isOneToOne: false;
            referencedRelation: 'trips';
            referencedColumns: ['id', 'currency'];
          },
        ];
      };
    };

    Views: {
      trip_balances: {
        Row: {
          trip_id: string;
          member_id: string;
          display_name: string;
          group_id: string | null;
          currency: string;
          net_minor: number;
        };
        Relationships: [];
      };
    };

    Functions: {
      create_trip_group: {
        Args: { p_trip_id: string; p_name: string; p_member_count?: number };
        Returns: string;
      };
      create_expense: {
        Args: {
          p_trip_id: string;
          p_description: string;
          p_amount_minor: number;
          p_paid_by: string;
          p_shares: { member_id: string; amount_minor: number }[];
          p_split_mode?: SplitModeDb;
          p_paid_at?: string;
        };
        Returns: string;
      };
      update_expense: {
        Args: {
          p_expense_id: string;
          p_description: string;
          p_amount_minor: number;
          p_paid_by: string;
          p_shares: { member_id: string; amount_minor: number }[];
          p_split_mode: SplitModeDb;
          p_paid_at: string;
        };
        Returns: undefined;
      };
      void_expense: {
        Args: { p_expense_id: string };
        Returns: undefined;
      };
      set_expense_settled: {
        Args: { p_expense_id: string; p_settled: boolean };
        Returns: undefined;
      };
      preview_trip_by_code: {
        Args: { p_join_code: string };
        Returns: {
          trip_id: string;
          trip_name: string;
          member_id: string;
          member_name: string;
          claimed: boolean;
        }[];
      };
      join_trip_by_code: {
        Args: { p_join_code: string; p_member_id: string };
        Returns: string;
      };
    };

    Enums: {
      trip_role: TripRole;
      split_mode: SplitModeDb;
    };

    CompositeTypes: Record<string, never>;
  };
}
