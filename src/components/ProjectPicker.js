// Project display helper. The inline project-picker dropdown that used to live
// here (switch list + Records search + add + share code) was removed — it
// duplicated the projects drawer (ProjectsDrawer), which is now the single place
// to switch/add projects. The Today plate opens that drawer directly.
//
// `parseProject` stays: it's the shared derivation used by the plate, the drawer,
// Settings, Review, and photo filenames.
import { projectCode } from "../schema";

// Records returns { id, name, status }. Derive a code, a clean display name
// (address suffix dropped) and a city from the real project name.
export function parseProject(p) {
  const name = p?.name ?? "";
  const parts = name.split(",").map((x) => x.trim());
  const street = parts[0] || name;
  const city = parts[1] || "";
  return { code: projectCode(name), display: street, city, address: name };
}
