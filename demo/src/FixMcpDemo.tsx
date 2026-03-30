import React from "react";
import {AbsoluteFill, Sequence, interpolate, spring, useCurrentFrame, useVideoConfig} from "remotion";

type SceneProps = {
  title: string;
  subtitle: string;
  body: string[];
  accent: string;
};

const palette = {
  ink: "#09111f",
  paper: "#f4efe6",
  grid: "rgba(9, 17, 31, 0.12)",
};

const SceneCard: React.FC<SceneProps> = ({title, subtitle, body, accent}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const reveal = spring({fps, frame, config: {damping: 200}});
  const lift = interpolate(reveal, [0, 1], [40, 0]);

  return (
    <AbsoluteFill
      style={{
        background: `radial-gradient(circle at top left, ${accent}55, transparent 35%), linear-gradient(135deg, ${palette.paper}, #d9e6f2)`,
        color: palette.ink,
        fontFamily: "Georgia, 'Times New Roman', serif",
        padding: 96,
      }}
    >
      <div
        style={{
          flex: 1,
          border: `2px solid ${palette.grid}`,
          borderRadius: 36,
          padding: 64,
          backgroundColor: "rgba(255,255,255,0.72)",
          backdropFilter: "blur(12px)",
          transform: `translateY(${lift}px)`,
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          boxShadow: "0 24px 80px rgba(9, 17, 31, 0.12)",
        }}
      >
        <div>
          <div
            style={{
              display: "inline-block",
              padding: "10px 18px",
              borderRadius: 999,
              backgroundColor: accent,
              color: "#fff",
              fontFamily: "Arial, sans-serif",
              fontSize: 22,
              letterSpacing: 2,
              textTransform: "uppercase",
            }}
          >
            FIX MCP Ops Walkthrough
          </div>
          <h1 style={{fontSize: 84, lineHeight: 1.02, margin: "28px 0 18px"}}>{title}</h1>
          <p style={{fontSize: 32, margin: 0, maxWidth: 1200}}>{subtitle}</p>
        </div>

        <div style={{display: "grid", gap: 18, marginTop: 48}}>
          {body.map((line, index) => (
            <div
              key={line}
              style={{
                fontSize: 30,
                padding: "18px 22px",
                borderLeft: `8px solid ${accent}`,
                backgroundColor: "rgba(9, 17, 31, 0.05)",
                transform: `translateX(${interpolate(reveal, [0, 1], [index * 24 + 30, 0])}px)`,
              }}
            >
              {line}
            </div>
          ))}
        </div>
      </div>
    </AbsoluteFill>
  );
};

const scenes: SceneProps[] = [
  {
    title: "ARCA Session Down",
    subtitle: "The morning triage opens with a broken ARCA FIX session, a sequence gap, and institutional flow at risk.",
    accent: "#b63a2b",
    body: [
      "Session state: DOWN with expected recv seq 4582 vs actual 4580.",
      "Twelve orders are stuck and three institutional SLAs are already inside the warning window.",
      "The operator leads with session health before any secondary cleanup.",
    ],
  },
  {
    title: "Recover With ResendRequest",
    subtitle: "FIX session recovery uses the exact protocol primitive rather than a vague reconnect-first workflow.",
    accent: "#285c9c",
    body: [
      "Generate ResendRequest (35=2) for the missing range.",
      "Realign receive sequence numbers and release venue-blocked orders.",
      "Show the formatted FIX message and raw pipe-delimited payload side by side.",
    ],
  },
  {
    title: "Route to Healthy Venue",
    subtitle: "A new order bypasses the down venue and routes to the next healthy destination automatically.",
    accent: "#157f6b",
    body: [
      "Send NewOrderSingle (35=D) for AAPL with ExDestination=XNYS.",
      "Track OMS order ID, ClOrdID, notional, and current order status.",
      "Demonstrate the cancel path through OrderCancelRequest (35=F).",
    ],
  },
  {
    title: "Surface Corporate Action Risk",
    subtitle: "Symbology problems are highlighted before they become exchange rejects at the open.",
    accent: "#8b5a15",
    body: [
      "ACME carries a same-day ticker change warning to ACMX.",
      "Affected open orders are quantified and flagged for operator action.",
      "The narrative stays operational: counts, deadlines, and precise FIX fields.",
    ],
  },
  {
    title: "Load IPO Symbol",
    subtitle: "Pending IPO flow is released by loading missing reference data into the local store.",
    accent: "#6a3ca5",
    body: [
      "Use load_symbology to create the symbol record and mark it active.",
      "Orders tagged symbol_not_loaded move back to NEW.",
      "This scene reinforces the dependency between reference data and order validity.",
    ],
  },
  {
    title: "Close With Pre-Market Summary",
    subtitle: "The final scene compresses session health, validation, symbology, and revenue risk into one triage view.",
    accent: "#1f3c88",
    body: [
      "Summarize critical items, warnings, and informational confirmations.",
      "Reconfirm active session count, open-order footprint, and institutional notional at risk.",
      "Position the MCP server as an operator console for AI-assisted trading support.",
    ],
  },
];

export const FixMcpDemo: React.FC = () => {
  return (
    <AbsoluteFill style={{backgroundColor: palette.paper}}>
      {scenes.map((scene, index) => (
        <Sequence key={scene.title} from={index * 150} durationInFrames={150}>
          <SceneCard {...scene} />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
};
