// Converts raw client events into weighted integrity flags.
// Every flag is advisory — it is evidence for a human to review, never an
// automatic accusation. AI "detection" here means behavioral signal
// (large pastes, long idle then sudden text), not a classifier verdict.
const WEIGHTS = {
  tab_blur: 2,            // left the exam tab/window
  fullscreen_exit: 3,
  paste: 6,              // pasted content into an answer (strongest practical signal)
  large_paste: 10,       // paste over threshold characters
  copy: 2,
  devtools: 8,
  second_session: 10,    // same attempt opened on another device
  ip_change: 5,
  rapid_answer: 3,       // answered faster than humanly reasonable
  idle_then_burst: 6,    // long idle then a sudden complete answer
  resize_small: 1,
  monitoring_blocked: 6  // the page's own integrity check reports tampering/blocking
};

function weightFor(type, detail) {
  if (type === 'paste') return (detail?.length || 0) > 180 ? WEIGHTS.large_paste : WEIGHTS.paste;
  return WEIGHTS[type] || 0;
}

function label(type) {
  return {
    tab_blur: 'Left the exam window',
    fullscreen_exit: 'Exited fullscreen',
    paste: 'Pasted text into an answer',
    large_paste: 'Pasted a large block of text',
    copy: 'Copied exam text',
    devtools: 'Opened developer tools',
    second_session: 'Opened the exam on a second device',
    ip_change: 'Network address changed mid-exam',
    rapid_answer: 'Answered unusually fast',
    idle_then_burst: 'Idle, then a sudden complete answer',
    resize_small: 'Shrank the window',
    monitoring_blocked: 'Monitoring may be blocked or tampered'
  }[type] || type;
}

module.exports = { WEIGHTS, weightFor, label };
