import { SURFACES, type Detent, type SurfaceId } from "../config/surfaces";

export function defaultDetentFor(surface: SurfaceId): Detent {
  return SURFACES.find((s) => s.id === surface)?.defaultDetent ?? "peek";
}

export interface ShellState {
  surface: SurfaceId;
  detent: Detent;
  atmosphereOpen: boolean;
}

export type ShellAction =
  | { type: "openSurface"; surface: SurfaceId; detent?: Detent }
  | { type: "setDetent"; detent: Detent }
  | { type: "toggleAtmosphere"; open?: boolean }
  | { type: "reset" };

export const initialShellState: ShellState = {
  surface: "explore",
  detent: "peek",
  atmosphereOpen: false,
};

export function shellReducer(state: ShellState, action: ShellAction): ShellState {
  switch (action.type) {
    case "openSurface":
      return {
        ...state,
        surface: action.surface,
        detent: action.detent ?? defaultDetentFor(action.surface),
        atmosphereOpen: false,
      };
    case "setDetent":
      return { ...state, detent: action.detent };
    case "toggleAtmosphere":
      return { ...state, atmosphereOpen: action.open ?? !state.atmosphereOpen };
    case "reset":
      return initialShellState;
  }
}
