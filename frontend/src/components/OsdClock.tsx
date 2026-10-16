import { useEffect, useState } from "react";

const timeNow = () =>
  new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

// The "PLAY 11:35 PM" line from a VCR on-screen display (decoration only).
export default function OsdClock() {
  const [time, setTime] = useState(timeNow);

  useEffect(() => {
    const timer = window.setInterval(() => setTime(timeNow()), 15_000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <div className="osd-clock" aria-label={`Current time ${time}`}>
      <span className="osd-play" aria-hidden="true" />
      <span aria-hidden="true">PLAY {time}</span>
    </div>
  );
}
