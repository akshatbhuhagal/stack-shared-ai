import * as fs from "fs";
import * as path from "path";
import { parse as parseYaml } from "yaml";
import { ScanOptions, ScanResult } from "../types";
import { heading, joinSections, bulletList } from "../../utils/markdown";

// Known package categories for auto-classification
const CATEGORY_MAP: Record<string, string[]> = {
  "State Management": [
    "flutter_riverpod", "riverpod", "hooks_riverpod",
    "flutter_bloc", "bloc", "equatable",
    "provider", "get", "getx", "get_it",
    "mobx", "flutter_mobx",
    "redux", "flutter_redux",
    "stacked",
  ],
  "Networking": [
    "dio", "http", "retrofit", "chopper",
    "graphql", "graphql_flutter", "ferry",
    "web_socket_channel",
  ],
  "Navigation": [
    "go_router", "auto_route", "beamer",
    "fluro", "routemaster",
  ],
  "Data & Serialization": [
    "freezed_annotation", "json_annotation", "json_serializable",
    "built_value", "built_collection",
    "hive", "hive_flutter",
    "isar", "isar_flutter_libs",
    "objectbox", "objectbox_flutter_libs",
    "drift", "moor",
    "sqflite",
  ],
  "Storage": [
    "shared_preferences", "flutter_secure_storage",
    "path_provider",
  ],
  "Firebase": [
    "firebase_core", "firebase_auth", "cloud_firestore",
    "firebase_storage", "firebase_messaging",
    "firebase_analytics", "firebase_crashlytics",
    "firebase_remote_config", "firebase_dynamic_links",
  ],
  "UI": [
    "flutter_svg", "cached_network_image", "shimmer",
    "flutter_spinkit", "lottie",
    "google_fonts", "flutter_screenutil",
    "flutter_animate", "animations",
    "cupertino_icons", "font_awesome_flutter",
    "material_design_icons_flutter",
  ],
  "Forms & Validation": [
    "flutter_form_builder", "form_builder_validators",
    "reactive_forms",
  ],
  "Media": [
    "image_picker", "image_cropper", "photo_view",
    "video_player", "chewie", "camera",
    "file_picker",
  ],
  "Maps & Location": [
    "google_maps_flutter", "geolocator", "geocoding",
    "flutter_map", "location",
  ],
  "Auth": [
    "google_sign_in", "flutter_facebook_auth",
    "sign_in_with_apple", "local_auth",
  ],
  "Notifications": [
    "flutter_local_notifications", "awesome_notifications",
    "onesignal_flutter",
  ],
  "Testing": [
    "mockito", "mocktail", "bloc_test",
    "network_image_mock",
  ],
  "Code Generation": [
    "build_runner", "freezed", "json_serializable",
    "auto_route_generator", "retrofit_generator",
    "injectable_generator", "hive_generator",
  ],
  "Utilities": [
    "intl", "url_launcher", "package_info_plus",
    "connectivity_plus", "device_info_plus",
    "permission_handler", "share_plus",
    "flutter_dotenv", "envied",
    "logger", "pretty_dio_logger",
    "uuid",
  ],
  "Dependency Injection": [
    "injectable", "get_it",
  ],
};

function categorize(packageName: string): string {
  for (const [category, packages] of Object.entries(CATEGORY_MAP)) {
    if (packages.includes(packageName)) return category;
  }
  return "Other";
}

export async function scanDeps(options: ScanOptions): Promise<ScanResult | null> {
  const pubspecPath = path.join(options.rootDir, "pubspec.yaml");
  if (!fs.existsSync(pubspecPath)) return null;

  let pubspec: Record<string, unknown>;
  try {
    const content = fs.readFileSync(pubspecPath, "utf-8");
    pubspec = parseYaml(content) as Record<string, unknown>;
  } catch {
    return null;
  }

  const deps = (pubspec.dependencies ?? {}) as Record<string, unknown>;
  const devDeps = (pubspec.dev_dependencies ?? {}) as Record<string, unknown>;

  // Remove flutter SDK itself from deps listing
  const filteredDeps = Object.entries(deps).filter(
    ([name, val]) => name !== "flutter" && !(typeof val === "object" && val !== null && "sdk" in (val as Record<string, unknown>))
  );

  const filteredDevDeps = Object.entries(devDeps).filter(
    ([name, val]) => name !== "flutter_test" && !(typeof val === "object" && val !== null && "sdk" in (val as Record<string, unknown>))
  );

  if (filteredDeps.length === 0 && filteredDevDeps.length === 0) return null;

  // Group by category
  const grouped: Record<string, string[]> = {};

  for (const [name, version] of filteredDeps) {
    const cat = categorize(name);
    if (!grouped[cat]) grouped[cat] = [];
    const ver = typeof version === "string" ? version : (typeof version === "object" && version !== null ? "path/git" : "any");
    grouped[cat].push(`${name}: ${ver}`);
  }

  // Build markdown
  const sections: string[] = [heading(1, "Dependencies")];

  // Sort categories: known first, "Other" last
  const sortedCategories = Object.keys(grouped).sort((a, b) => {
    if (a === "Other") return 1;
    if (b === "Other") return -1;
    return a.localeCompare(b);
  });

  for (const cat of sortedCategories) {
    sections.push(joinSections(heading(2, cat), bulletList(grouped[cat])));
  }

  // Dev dependencies
  if (filteredDevDeps.length > 0) {
    const devGrouped: Record<string, string[]> = {};
    for (const [name, version] of filteredDevDeps) {
      const cat = categorize(name);
      if (!devGrouped[cat]) devGrouped[cat] = [];
      const ver = typeof version === "string" ? version : "path/git";
      devGrouped[cat].push(`${name}: ${ver}`);
    }

    sections.push(heading(2, "Dev Dependencies"));
    const sortedDevCats = Object.keys(devGrouped).sort((a, b) => {
      if (a === "Other") return 1;
      if (b === "Other") return -1;
      return a.localeCompare(b);
    });
    for (const cat of sortedDevCats) {
      sections.push(joinSections(heading(3, cat), bulletList(devGrouped[cat])));
    }
  }

  const content = sections.join("\n\n") + "\n";

  return {
    filename: "deps.md",
    content,
  };
}
