export type Role = "owner" | "editor" | "viewer";
export type Access = "read" | "write" | "admin";

const RANK: Record<Role, number> = {
  viewer: 1,
  editor: 2,
  owner: 3,
};

const REQUIRED_RANK: Record<Access, number> = {
  read: 1,
  write: 2,
  admin: 3,
};

export function roleAllows(role: Role, access: Access): boolean {
  return RANK[role] >= REQUIRED_RANK[access];
}
