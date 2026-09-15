/**
 * Kiểu dữ liệu phản chiếu schema trong supabase/migrations/.
 *
 * Viết tay để khớp đúng 4 migration hiện có. Khi schema đổi, sinh lại bằng:
 *   npx supabase gen types typescript --project-id <ref> > src/lib/supabase/database.types.ts
 *
 * HAI RÀNG BUỘC CỦA supabase-js, sai là mọi truy vấn suy ra kiểu `never`:
 *  1. Mỗi Table và View PHẢI có mảng `Relationships`, kể cả khi rỗng.
 *  2. `Insert`/`Update` phải là object type. Không được dùng `never` — nó phá
 *     ràng buộc Record<string, unknown>. Bảng cấm ghi thì dùng
 *     Record<string, never>: vẫn thoả ràng buộc, và mọi lệnh insert vẫn bị
 *     TypeScript chặn tại chỗ.
 *
 * Về bigint: PostgREST trả cột bigint dưới dạng số JSON. Mọi giá trị *_minor
 * vì thế khai là number, nhưng PHẢI đi qua toSafeMinor() trước khi dùng — số
 * vượt ngưỡng an toàn của JavaScript sẽ mất chính xác mà không báo lỗi.
 */

export type GroupRole = 'owner' | 'member';

/** Bảng chỉ cho đọc: ghi phải đi qua RPC. Xem AGENTS.md mục 4. */
type ReadOnly = Record<string, never>;

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          display_name: string;
          avatar_url: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          display_name: string;
          avatar_url?: string | null;
        };
        Update: {
          display_name?: string;
          avatar_url?: string | null;
        };
        // id tham chiếu auth.users, nằm ngoài schema public nên không khai ở đây.
        Relationships: [];
      };

      groups: {
        Row: {
          id: string;
          name: string;
          currency: string;
          created_by: string;
          created_at: string;
          updated_at: string;
          deleted_at: string | null;
        };
        Insert: {
          id?: string;
          name: string;
          currency: string;
          created_by: string;
        };
        Update: {
          name?: string;
          deleted_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'groups_created_by_fkey';
            columns: ['created_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };

      group_members: {
        Row: {
          group_id: string;
          user_id: string;
          role: GroupRole;
          joined_at: string;
          left_at: string | null;
        };
        Insert: {
          group_id: string;
          user_id: string;
          role?: GroupRole;
        };
        Update: {
          role?: GroupRole;
          left_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'group_members_group_id_fkey';
            columns: ['group_id'];
            isOneToOne: false;
            referencedRelation: 'groups';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'group_members_user_id_fkey';
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
          group_id: string;
          currency: string;
          description: string;
          amount_minor: number;
          paid_at: string;
          created_by: string;
          created_at: string;
          updated_at: string;
          deleted_at: string | null;
        };
        // Cố ý không cho insert trực tiếp: bảng này không có policy INSERT,
        // tạo khoản chi phải qua RPC create_expense().
        Insert: ReadOnly;
        Update: {
          description?: string;
          paid_at?: string;
          deleted_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'expenses_group_currency_fkey';
            columns: ['group_id', 'currency'];
            isOneToOne: false;
            referencedRelation: 'groups';
            referencedColumns: ['id', 'currency'];
          },
          {
            foreignKeyName: 'expenses_created_by_fkey';
            columns: ['created_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };

      expense_payments: {
        Row: {
          expense_id: string;
          user_id: string;
          amount_minor: number;
        };
        Insert: ReadOnly;
        Update: ReadOnly;
        Relationships: [
          {
            foreignKeyName: 'expense_payments_expense_id_fkey';
            columns: ['expense_id'];
            isOneToOne: false;
            referencedRelation: 'expenses';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'expense_payments_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };

      expense_shares: {
        Row: {
          expense_id: string;
          user_id: string;
          amount_minor: number;
        };
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
            foreignKeyName: 'expense_shares_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };

      settlements: {
        Row: {
          id: string;
          group_id: string;
          currency: string;
          from_user: string;
          to_user: string;
          amount_minor: number;
          settled_at: string;
          note: string | null;
          created_by: string;
          created_at: string;
          deleted_at: string | null;
        };
        Insert: {
          id?: string;
          group_id: string;
          currency: string;
          from_user: string;
          to_user: string;
          amount_minor: number;
          settled_at?: string;
          note?: string | null;
          created_by: string;
        };
        Update: {
          note?: string | null;
          deleted_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'settlements_group_currency_fkey';
            columns: ['group_id', 'currency'];
            isOneToOne: false;
            referencedRelation: 'groups';
            referencedColumns: ['id', 'currency'];
          },
          {
            foreignKeyName: 'settlements_from_user_fkey';
            columns: ['from_user'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'settlements_to_user_fkey';
            columns: ['to_user'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
    };

    Views: {
      group_balances: {
        Row: {
          group_id: string;
          user_id: string;
          currency: string;
          net_minor: number;
        };
        Relationships: [];
      };
    };

    Functions: {
      create_expense: {
        Args: {
          p_group_id: string;
          p_description: string;
          p_amount_minor: number;
          p_payments: { user_id: string; amount_minor: number }[];
          p_shares: { user_id: string; amount_minor: number }[];
          p_paid_at?: string;
        };
        Returns: string;
      };
      void_expense: {
        Args: { p_expense_id: string };
        Returns: undefined;
      };
    };

    Enums: {
      group_role: GroupRole;
    };

    CompositeTypes: Record<string, never>;
  };
}
