// Stand-in for the real Supabase Auth session. Swap for a real lookup (cookies() + Supabase
// server client) once login is wired — every caller already reads through this one function.
import type { AppUser } from "./types";

export function getCurrentUser(): AppUser {
  return {
    id: "u-sergio",
    name: "Sergio Mendes",
    email: "sergio.mendes@essencislabs.com",
    title: "Admin",
    role: "admin",
    mustResetPassword: false,
  };
}

export function getAllUsers(): AppUser[] {
  return [
    getCurrentUser(),
    {
      id: "u-joao",
      name: "João Fiori",
      email: "joao@essencislabs.com",
      title: "CEO",
      role: "scrum_master",
      mustResetPassword: false,
    },
    {
      id: "u-luiz",
      name: "Luiz D'Amore",
      email: "luiz@essencislabs.com",
      title: "Coordenador Dev Senior",
      role: "scrum_master",
      mustResetPassword: false,
    },
  ];
}
