import { NextResponse } from "next/server";
import path from "path";
import fs from "fs/promises";
import { spawn } from "child_process";

export const runtime = "nodejs";

type GenerateResult = {
  ok: boolean;
  chart?: any;
  error?: string;
};

async function runPythonAnalyzer(inputPath: string): Promise<string> {
  const outPath = inputPath.replace(/\.(wav|mp3|m4a|flac)$/i, "") + ".chartpack.json";

  await new Promise<void>((resolve, reject) => {
    const pythonBin = process.env.PYTHON_BIN || "python3";
    const scriptPath = path.join(process.cwd(), "scripts", "analyze_audio.py");

    const py = spawn(
      pythonBin,
      [scriptPath, "--in", inputPath, "--out", outPath],
      { cwd: process.cwd() }
    );

    let stderr = "";

    py.stdout.on("data", (d) => {
      console.log(`[Python stdout] ${d.toString().trim()}`);
    });
    
    py.stderr.on("data", (d) => {
      const msg = d.toString().trim();
      stderr += msg + "\n";
      console.error(`[Python stderr] ${msg}`);
    });

    py.on("error", (err) => {
      console.error(`[Python error] Process spawn failed:`, err);
      reject(err);
    });
    
    py.on("close", (code) => {
      console.log(`[Python close] Process exited with code ${code}`);
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Python script failed with code ${code}. Stderr: ${stderr}`));
      }
    });
  });

  return outPath;
}

function transformChartToPackFormat(chart: any): any {
  // The Python script already outputs in pack format with barsFlat
  // We just need to ensure the profiles structure matches what the UI expects
  
  if (!chart.profiles) {
    chart.profiles = {};
  }

  // Transform profiles from nested structure to flat structure
  if (chart.profiles.defaults) {
    chart.profiles.Default = chart.profiles.defaults;
  }
  
  if (chart.profiles.named) {
    Object.assign(chart.profiles, chart.profiles.named);
  }

  // Clean up old structure
  delete chart.profiles.defaults;
  delete chart.profiles.named;

  // Ensure hitsFlat exists (it's the same as hits in the Python output)
  if (!chart.hitsFlat && chart.hits) {
    chart.hitsFlat = chart.hits;
  }

  // Ensure sections array exists from regions
  if (!chart.sections && chart.regions?.sections) {
    chart.sections = chart.regions.sections;
  }

  // Ensure repeats array exists
  if (!chart.repeats && chart.regions?.repeatRegions) {
    chart.repeats = chart.regions.repeatRegions;
  }

  return chart;
}

export async function POST(req: Request) {
  const result: GenerateResult = { ok: false };

  try {
    const form = await req.formData();
    const file = form.get("audio") as File | null;

    if (!file) {
      result.error = "Missing form field 'audio' (file).";
      return NextResponse.json(result, { status: 400 });
    }

    console.log(`[API] Received file: ${file.name} (${file.size} bytes)`);

    // Validate file type
    const validExtensions = ['.wav', '.mp3', '.m4a', '.flac'];
    const fileExt = path.extname(file.name).toLowerCase();
    if (!validExtensions.includes(fileExt)) {
      result.error = `Invalid file type. Supported formats: ${validExtensions.join(', ')}`;
      return NextResponse.json(result, { status: 400 });
    }

    // Validate file size (max 100MB)
    const maxSize = 100 * 1024 * 1024;
    if (file.size > maxSize) {
      result.error = 'File too large. Maximum size is 100MB.';
      return NextResponse.json(result, { status: 400 });
    }

    // Save upload to /tmp
    const bytes = Buffer.from(await file.arrayBuffer());
    const safeName = (file.name || "upload.wav").replace(/[^\w.\-]+/g, "_");
    const tmpDir = process.env.TMPDIR || "/tmp";
    const inPath = path.join(tmpDir, `${Date.now()}_${safeName}`);

    await fs.writeFile(inPath, bytes);
    console.log(`[API] Saved upload to: ${inPath}`);

    // Run analyzer
    console.log('[API] Starting Python audio analyzer...');
    const chartPath = await runPythonAnalyzer(inPath);

    // Read analyzer output
    console.log(`[API] Reading chart from: ${chartPath}`);
    const chartRaw = await fs.readFile(chartPath, "utf8");
    let chart = JSON.parse(chartRaw);

    // Transform to expected format
    chart = transformChartToPackFormat(chart);

    // Validate required fields
    if (!chart.schemaVersion) {
      throw new Error('Generated chart missing schemaVersion');
    }
    if (!chart.meta?.title) {
      throw new Error('Generated chart missing meta.title');
    }
    if (!chart.timeline) {
      throw new Error('Generated chart missing timeline');
    }
    if (!Array.isArray(chart.barsFlat)) {
      throw new Error('Generated chart missing barsFlat array');
    }
    if (!Array.isArray(chart.hitsFlat)) {
      throw new Error('Generated chart missing hitsFlat array');
    }
    if (!chart.profiles) {
      throw new Error('Generated chart missing profiles');
    }

    console.log(`[API] Chart validated: ${chart.barsFlat.length} bars, ${chart.hitsFlat.length} hits`);

    // Clean up temporary files
    try {
      await fs.unlink(inPath);
      await fs.unlink(chartPath);
      console.log('[API] Cleaned up temporary files');
    } catch (cleanupErr) {
      console.warn(`[API] Warning: Failed to clean up temp files:`, cleanupErr);
    }

    result.ok = true;
    result.chart = chart;

    return NextResponse.json(result);
  } catch (err: any) {
    console.error('[API] Error:', err);
    result.error = err?.message || String(err);
    
    return NextResponse.json(result, { status: 500 });
  }
}

// END OF FILE