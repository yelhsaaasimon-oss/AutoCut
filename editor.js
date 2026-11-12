// The parser is intentionally deterministic: unmatched text never becomes an edit.
export const EXAMPLES = [
  'Trim the first 5 seconds', 'Remove the last 10 seconds',
  'Make the video vertical (9:16)', 'Make the video square (1:1)',
  'Convert to black and white', 'Brighten the video',
  'Add fade-in and fade-out', 'Mute the audio', 'Lower the audio volume',
  'Increase the video speed to 2x', 'Slow the video down to half speed'
];

export function parseInstructions(text) {
  const plan = { edits: [], errors: [], trimStart: 0, trimEnd: 0, speed: 1, volume: 1,
    aspect: null, grayscale: false, brighten: false, fadeIn: false, fadeOut: false };
  const seen = new Set();
  const normalized = text.toLowerCase().replace(/[“”‘’]/g, "'")
    .replace(/black[ -]and[ -]white/g, 'black white')
    .replace(/fade[ -]?in/g, 'fadein').replace(/fade[ -]?out/g, 'fadeout')
    .replace(/\bhalf[ -]speed\b/g, '0.5x speed');
  const clauses = normalized.split(/[,;\n!?]+|\.(?!\d)|\b(?:and|then)\b/).map(s => s.trim()).filter(Boolean);
  function add(key, value, label) {
    if (seen.has(key)) {
      plan.errors.push(`Use only one ${key === 'aspect' ? 'aspect ratio' : key === 'speed' ? 'speed instruction' : key === 'volume' ? 'audio volume instruction' : label.toLowerCase()} per edit.`);
      return;
    }
    seen.add(key); plan[key] = value; plan.edits.push({ key, label });
  }
  for (let clause of clauses) {
    clause = clause.replace(/^please\s+/, '').replace(/\s+please$/, '').trim();
    let match;
    if ((match = clause.match(/^(?:trim|remove|cut|cut off)(?: off)?(?: the)? (first|last|start|end) (\d+(?:\.\d+)?) (?:seconds?|secs?|s)$/))) {
      const amount = Number(match[2]);
      if (amount <= 0) { plan.errors.push('Trim time must be greater than zero.'); continue; }
      const start = ['first', 'start'].includes(match[1]);
      add(start ? 'trimStart' : 'trimEnd', amount, `Trim ${amount}s from the ${start ? 'start' : 'end'}`);
    } else if (/^(?:make(?: it| the video)?|convert(?: it| the video)? to|crop(?: it| the video)? to|vertical) (?:vertical(?: \(?9:16\)?)?|9:16)$/.test(clause) || /^(?:vertical(?: \(?9:16\)?)?|9:16)$/.test(clause)) {
      add('aspect', '9:16', 'Center-crop to vertical · 9:16');
    } else if (/^(?:make(?: it| the video)?|convert(?: it| the video)? to|crop(?: it| the video)? to) (?:square(?: \(?1:1\)?)?|1:1)$/.test(clause) || /^(?:square(?: \(?1:1\)?)?|1:1)$/.test(clause)) {
      add('aspect', '1:1', 'Center-crop to square · 1:1');
    } else if (/^(?:(?:convert(?: it| the video)? to|make(?: it| the video)?) )?(?:black white|black & white|grayscale)$/.test(clause)) {
      add('grayscale', true, 'Convert to black & white');
    } else if (/^(?:brighten(?: it| the video)?|make(?: it| the video)? brighter)$/.test(clause)) {
      add('brighten', true, 'Brighten the video · +8%');
    } else if (/^(?:add |apply )?(?:a )?fadein$/.test(clause)) {
      add('fadeIn', true, 'Fade in · up to 1 second');
    } else if (/^(?:add |apply )?(?:a )?fadeout$/.test(clause)) {
      add('fadeOut', true, 'Fade out · up to 1 second');
    } else if (/^mute(?: it| the audio| audio| the video)?$/.test(clause)) {
      add('volume', 0, 'Mute the audio');
    } else if ((match = clause.match(/^(?:lower|reduce)(?: the)? (?:audio volume|volume|audio)(?: to (\d+(?:\.\d+)?)%)?$/))) {
      const volume = match[1] === undefined ? 0.5 : Number(match[1]) / 100;
      if (volume > 1) { plan.errors.push('Lower volume must be between 0% and 100%.'); continue; }
      add('volume', volume, `Audio volume · ${Math.round(volume * 100)}%`);
    } else if ((match = clause.match(/^(?:(?:increase|set|change)(?: the)? (?:video )?speed to|speed(?: it| the video)? up(?: to)?|slow(?: it| the video)? down to|(?:video )?speed) (\d+(?:\.\d+)?)x(?: speed)?$/)) || (match = clause.match(/^(\d+(?:\.\d+)?)x(?: speed)?$/))) {
      const speed = Number(match[1]);
      if (speed < 0.25 || speed > 4) { plan.errors.push('Speed must be between 0.25x and 4x.'); continue; }
      add('speed', speed, `Playback speed · ${speed}×`);
    } else {
      plan.errors.push(`Not supported: “${clause}”. Try a command from “See all supported edits”.`);
    }
  }
  return plan;
}

export function timing(plan, duration) {
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('This video has no readable duration. Try a standard MP4 video.');
  const trimmed = duration - plan.trimStart - plan.trimEnd;
  if (trimmed < 0.1) throw new Error(`Those trims remove the entire ${duration.toFixed(1)}-second video. Use shorter trim times.`);
  return { trimmed, outputDuration: trimmed / plan.speed };
}

function tempoFilters(speed) {
  const filters = [];
  while (speed > 2) { filters.push('atempo=2'); speed /= 2; }
  while (speed < 0.5) { filters.push('atempo=0.5'); speed /= 0.5; }
  if (speed !== 1) filters.push(`atempo=${speed}`);
  return filters;
}

export function buildCommand(plan, duration, format = 'mp4', inputName = 'input.mp4') {
  if (plan.errors.length) throw new Error('Fix unsupported instructions before processing.');
  const { trimmed, outputDuration } = timing(plan, duration);
  if (format === 'mp3' && (plan.aspect || plan.grayscale || plan.brighten)) throw new Error('Audio-only export cannot apply visual edits. Remove the crop, black & white, or brighten instructions, or choose MP4.');
  if (format === 'mp3' && plan.volume === 0) throw new Error('Muted audio has nothing to export. Remove “mute” or choose MP4.');
  const fadeDuration = Math.min(1, outputDuration / 2);
  const fadeStart = Math.max(0, outputDuration - fadeDuration);
  const vf = ['setpts=PTS-STARTPTS'];
  if (plan.aspect === '9:16') vf.push("crop=w='trunc(min(iw,ih*9/16)/2)*2':h='trunc(min(ih,iw*16/9)/2)*2'");
  if (plan.aspect === '1:1') vf.push("crop=w='trunc(min(iw,ih)/2)*2':h='trunc(min(iw,ih)/2)*2'");
  // Do not upscale. Cap the long edge at 1280px to keep phone memory use reasonable.
  vf.push("scale=w='trunc(iw*min(1,1280/max(iw,ih))/2)*2':h='trunc(ih*min(1,1280/max(iw,ih))/2)*2'");
  vf.push('setsar=1');
  if (plan.grayscale) vf.push('hue=s=0');
  if (plan.brighten) vf.push('eq=brightness=0.08');
  if (plan.speed !== 1) vf.push(`setpts=PTS/${plan.speed}`);
  if (plan.fadeIn) vf.push(`fade=t=in:st=0:d=${fadeDuration}`);
  if (plan.fadeOut) vf.push(`fade=t=out:st=${fadeStart}:d=${fadeDuration}`);
  const af = ['asetpts=PTS-STARTPTS', ...tempoFilters(plan.speed)];
  if (plan.volume !== 1) af.push(`volume=${plan.volume}`);
  if (plan.fadeIn) af.push(`afade=t=in:st=0:d=${fadeDuration}`);
  if (plan.fadeOut) af.push(`afade=t=out:st=${fadeStart}:d=${fadeDuration}`);
  const args = ['-hide_banner', '-y', '-threads', '1'];
  if (plan.trimStart) args.push('-ss', String(plan.trimStart));
  // Limit INPUT duration; an output -t would cut slow-motion edits short.
  args.push('-t', String(trimmed), '-i', inputName);
  if (format === 'mp3') {
    args.push('-map', '0:a:0', '-vn', '-af', af.join(','), '-c:a', 'libmp3lame', '-b:a', '192k', '-threads', '1', 'output.mp3');
  } else {
    args.push('-map', '0:v:0', '-vf', vf.join(','), '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '23', '-pix_fmt', 'yuv420p', '-threads', '1');
    if (plan.volume === 0) args.push('-an');
    else args.push('-map', '0:a:0?', '-af', af.join(','), '-c:a', 'aac', '-b:a', '128k');
    args.push('-movflags', '+faststart', '-map_metadata', '-1', 'output.mp4');
  }
  return { args, outputDuration };
}
