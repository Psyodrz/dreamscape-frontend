#!/usr/bin/env node
/**
 * KTX2 Texture Converter for DreamScape
 *
 * Converts game textures to KTX2 format using sharp + ktx-software
 * This is a simpler approach that creates optimized textures for the game.
 *
 * Usage: npm run convert-textures
 */

import { execSync } from "child_process";
import { existsSync, mkdirSync, readdirSync, statSync, copyFileSync } from "fs";
import { join, dirname, basename, extname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PROJECT_ROOT = join(__dirname, "..");
const TEXTURES_DIR = join(PROJECT_ROOT, "assets", "textures");
const KTX2_OUTPUT_DIR = join(PROJECT_ROOT, "assets", "textures-ktx2");

// Only convert textures actually used in the game
const USED_TEXTURES = [
  // Wall textures (ChatGPT folder)
  "ChatGPT/Albedo.png",
  "ChatGPT/Normal.png",
  "ChatGPT/Roughness.png",
  "ChatGPT/Metallic.png",
  // Floor textures (Ground folder)
  "Ground/Albedo.png",
  "Ground/Normal.png",
  "Ground/Roughness.png",
  "Ground/Metallic.png",
  "Ground/Height.png",
];

/**
 * Check if a command exists
 */
function commandExists(cmd) {
  try {
    execSync(`where ${cmd}`, { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

/**
 * Convert PNG to KTX2 using toktx (from KTX-Software)
 */
function convertWithToktx(inputPath, outputPath, isNormalMap = false) {
  // toktx command with UASTC encoding (best quality GPU compression)
  const args = [
    "toktx",
    "--t2", // KTX2 format
    "--encode",
    "uastc", // UASTC encoding
    "--uastc_quality",
    isNormalMap ? "4" : "3", // Higher quality for normal maps
    "--zcmp",
    "18", // Zstandard supercompression
    "--genmipmap", // Generate mipmaps
  ];

  if (isNormalMap) {
    args.push("--normal_map"); // Optimize for normal maps
  }

  args.push(`"${outputPath}"`, `"${inputPath}"`);

  execSync(args.join(" "), { stdio: "pipe" });
}

/**
 * Convert using basisu encoder (bundled with Basis Universal)
 */
function convertWithBasisu(inputPath, outputPath, isNormalMap = false) {
  const outputDir = dirname(outputPath);
  const outputName = basename(outputPath, ".ktx2");

  const args = [
    "npx",
    "basisu-encoder",
    `"${inputPath}"`,
    "-output_path",
    `"${outputDir}"`,
    "-output_file",
    `"${outputName}"`,
    "-ktx2", // Output KTX2
    "-uastc", // Use UASTC
    "-mipmap",
  ];

  if (isNormalMap) {
    args.push("-normal_map");
  }

  execSync(args.join(" "), { stdio: "pipe" });
}

/**
 * Simple fallback: Just copy PNG files (KTX2 conversion optional)
 * The TextureEngine will still work with PNG fallback
 */
function copyAsPng(inputPath, outputPath) {
  // For now, we'll document that users need KTX-Software installed
  // The game works without KTX2, just with larger files
  console.log(`  ℹ️  Keeping as PNG (KTX-Software not installed)`);
  const pngOutput = outputPath.replace(".ktx2", ".png");
  copyFileSync(inputPath, pngOutput);
  return false;
}

/**
 * Main conversion
 */
async function main() {
  console.log("🎨 KTX2 Texture Converter for DreamScape");
  console.log("=========================================\n");

  // Create output directory
  if (!existsSync(KTX2_OUTPUT_DIR)) {
    mkdirSync(KTX2_OUTPUT_DIR, { recursive: true });
    console.log(`📁 Created output directory: ${KTX2_OUTPUT_DIR}\n`);
  }

  // Create subdirectories
  for (const subdir of ["ChatGPT", "Ground"]) {
    const path = join(KTX2_OUTPUT_DIR, subdir);
    if (!existsSync(path)) {
      mkdirSync(path, { recursive: true });
    }
  }

  // Check for toktx
  const hasToktx = commandExists("toktx");
  if (!hasToktx) {
    console.log("⚠️  toktx (KTX-Software) not found in PATH.");
    console.log(
      "   Download from: https://github.com/KhronosGroup/KTX-Software/releases",
    );
    console.log(
      "   Falling back to copying PNG files (TextureEngine handles this fallback)...\n",
    );
  }

  let converted = 0;
  let failed = 0;
  let totalSrcSize = 0;
  let totalDstSize = 0;

  for (const texPath of USED_TEXTURES) {
    const inputPath = join(TEXTURES_DIR, texPath);
    const outputPath = join(
      KTX2_OUTPUT_DIR,
      texPath.replace(/\.png$/i, ".ktx2"),
    );

    if (!existsSync(inputPath)) {
      console.log(`  ❌ Not found: ${texPath}`);
      failed++;
      continue;
    }

    const isNormalMap = texPath.toLowerCase().includes("normal");
    const srcSize = statSync(inputPath).size;
    totalSrcSize += srcSize;

    console.log(`  🔄 Processing: ${texPath}`);

    try {
      if (hasToktx) {
        convertWithToktx(inputPath, outputPath, isNormalMap);

        const dstSize = statSync(outputPath).size;
        totalDstSize += dstSize;
        const ratio = ((1 - dstSize / srcSize) * 100).toFixed(1);

        console.log(
          `     ✅ Converted → ${basename(outputPath)} (${ratio}% smaller)`,
        );
        converted++;
      } else {
        // Fallback: Copy as PNG but change extension to .ktx2?
        // No, that would confuse the loader.
        // We copy as PNG and the TextureEngine fallback logic handles loading the original PNG
        // effectively ignoring the missing KTX2.
        // BUT here we want to output to the new folder.
        // So we just copy the PNG to the new folder.

        const pngOutput = outputPath.replace(".ktx2", ".png");
        copyFileSync(inputPath, pngOutput);

        totalDstSize += srcSize;
        console.log(`     ℹ️  Copied as PNG`);
        converted++;
      }
    } catch (error) {
      console.log(`     ❌ Failed: ${error.message}`);
      failed++;
    }
  }

  console.log("\n=========================================");
  console.log("📊 Conversion Summary");
  console.log("=========================================");
  console.log(`  ✅ Converted: ${converted}`);
  console.log(`  ❌ Failed: ${failed}`);

  if (hasToktx && converted > 0) {
    const savedMB = ((totalSrcSize - totalDstSize) / 1024 / 1024).toFixed(2);
    const ratio = ((1 - totalDstSize / totalSrcSize) * 100).toFixed(1);
    console.log(`\n  💾 Total savings: ${savedMB} MB (${ratio}% reduction)`);
  }

  if (!hasToktx) {
    console.log(
      "\n  ℹ️  PNG files copied. Install KTX-Software for true KTX2 compression.",
    );
  }

  console.log("\n✨ Done!\n");

  // Print next steps
  console.log("📋 Next Steps:");
  console.log("   1. Update TextureEngine paths to use textures-ktx2/ folder");
  console.log(
    "   2. Or install KTX-Software and re-run for true compression\n",
  );
}

main().catch(console.error);
