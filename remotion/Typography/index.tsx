import React from 'react';
import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';

export const Typography: React.FC = () => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();

  const opacity = interpolate(
    frame,
    [0, 30],
    [0, 1],
    {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    }
  );

  const y = spring({
    fps,
    frame,
    config: {
      damping: 20,
      stiffness: 100,
    },
  });

  return (
    <AbsoluteFill
      style={{
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: '#1D1D1F',
        fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", sans-serif',
      }}
    >
      <div
        style={{
          fontSize: 120,
          fontWeight: 700,
          color: '#FFFFFF',
          letterSpacing: '-0.04em',
          opacity,
          transform: `translateY(${interpolate(y, [0, 1], [50, 0])}px)`,
          marginBottom: 40,
        }}
      >
        Typography
      </div>
      <div
        style={{
          fontSize: 48,
          fontWeight: 400,
          color: '#86868B',
          opacity: interpolate(frame, [30, 60], [0, 1]),
          transform: `translateY(${interpolate(
            spring({
              fps,
              frame: frame - 30,
              config: {damping: 20, stiffness: 100},
            }),
            [0, 1],
            [30, 0]
          )}px)`,
        }}
      >
        Beautifully crafted
      </div>
    </AbsoluteFill>
  );
};
