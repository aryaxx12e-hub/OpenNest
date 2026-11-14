"use client";

import { createContext, useContext, useState, type ReactNode } from "react";

import {
  createSaveCoordinator,
  type SaveCoordinator,
} from "../autosave/save-coordinator";

const SaveCoordinatorContext = createContext<SaveCoordinator | null>(null);

export interface SaveCoordinatorProviderProps {
  children: ReactNode;
  coordinator?: SaveCoordinator;
}

export function SaveCoordinatorProvider({
  children,
  coordinator,
}: SaveCoordinatorProviderProps) {
  const [value] = useState(() => coordinator ?? createSaveCoordinator());

  return (
    <SaveCoordinatorContext.Provider value={value}>
      {children}
    </SaveCoordinatorContext.Provider>
  );
}

export function useSaveCoordinator(): SaveCoordinator {
  const context = useContext(SaveCoordinatorContext);

  if (context === null) {
    throw new Error("useSaveCoordinator must be used inside SaveCoordinatorProvider");
  }

  return context;
}
