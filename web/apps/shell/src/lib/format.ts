/** CPU in millicores: "240m" below one core, "1.50 core" from one up. */
export function fmtCpu(millis: number): string {
  if (millis >= 1000) return `${(millis / 1000).toFixed(2)} core`;
  return `${Math.max(1, Math.round(millis))}m`;
}

/** Bytes in binary units: "512B", "40.0Mi", "270Mi", "3.0Gi". */
export function fmtBytes(bytes: number): string {
  if (bytes <= 0) return "0";
  const units = ["B", "Ki", "Mi", "Gi"];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v.toFixed(v >= 100 || i === 0 ? 0 : 1)}${units[i]}`;
}
