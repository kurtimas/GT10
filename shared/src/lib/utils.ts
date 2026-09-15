import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Tinted chip classes per crop — amber corn, gold wheat, green soybeans,
 *  forest sorghum/milo; works on light and night surfaces via tokens. */
export function cropBadgeClass(crop: string): string {
  switch (crop) {
    case "Corn":
      return "border-live/40 bg-live/10 text-live";
    case "Wheat":
      return "border-go/40 bg-go/10 text-go";
    case "Soybeans":
      return "border-stable/40 bg-stable/10 text-stable";
    case "Sorghum":
    case "Milo":
      return "border-primary/40 bg-primary/10 text-primary";
    default:
      return "border-border bg-muted text-muted-foreground";
  }
}

/** Solid grain-fill color per crop, for the bin level graphic on Bins. */
export function cropFillClass(crop: string): string {
  switch (crop) {
    case "Corn":
      return "bg-live";
    case "Wheat":
      return "bg-go";
    case "Soybeans":
      return "bg-stable";
    case "Sorghum":
    case "Milo":
      return "bg-primary";
    default:
      return "bg-muted-foreground";
  }
}
