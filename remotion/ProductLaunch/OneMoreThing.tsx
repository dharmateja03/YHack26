import React from 'react';
import {
  AbsoluteFill,
  Easing,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';

interface OneMoreThingProps {
  surpriseText?: string;
}

export const OneMoreThing: React.FC<OneMoreThingProps> = ({
  surpriseText = 'And one more thing...',
}) => {
  const frame = useCurrentFrame();
  const {durationInFrames} = useVideoConfig();

  // Fade in background
  const bgOpacity = interpolate(
    frame,
    [0, 20],
    [0, 1],
    {
      easing: Easing.bezier(0.4, 0, 0.2, 1),
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    }
  );

  // Text fade in with dramatic timing
  const textOpacity = interpolate(
    frame,
    [40, 70],
    [0, 1],
    {
      easing: Easing.bezier(0.4, 0, 0.2, 1),
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    }
  );

  // Subtle text scale
  const textScale = interpolate(
    frame,
    [40, 100],
    [0.95, 1],
    {
      easing: Easing.bezier(0.4, 0, 0.2, 1),
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    }
  );

  // Fade out at end
  const fadeOut = interpolate(
    frame,
    [durationInFrames - 30, durationInFrames - 10],
    [1, 0],
    {
      easing: Easing.bezier(0.4, 0, 0.2, 1),
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    }
  );

  return (
    <AbsoluteFill
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        background: `linear-gradient(135deg, #FF6B35 0%, #FF8E53 50%, #FFB347 100%)`,
        opacity: bgOpacity * fadeOut,
      }}
    >
      {/* The iconic phrase */}
      <div
        style={{
          fontSize: 80,
          fontWeight: 500,
          color: '#FFFFFF',
          letterSpacing: '-0.02em',
          opacity: textOpacity,
          transform: `scale(${textScale})`,
          textAlign: 'center',
          lineHeight: 1.2,
          textShadow: '0 4px 30px rgba(0,0,0,0.1)',
        }}
      >
        {surpriseText}
      </div>

      {/* Decorative elements - subtle circles */}
      <Circles frame={frame} />
    </AbsoluteFill>
  );
};

const Circles: React.FC<{frame: number}> = ({frame}) => {
  const circles = [
    { size: 400, delay: 60, x: -200, y: -100 },
    { size: 300, delay: 80, x: 200, y: 100 },
    { size: 250, delay: 100, x: -100, y: 150 },
  ];

  return (
    <>
      {circles.map((circle, index) => {
        const opacity = interpolate(
          frame,
          [circle.delay, circle.delay + 40],
          [0, 0.15],
          {
            easing: Easing.bezier(0.4, 0, 0.2, 1),
            extrapolateLeft: 'clamp',
            extrapolateRight: 'clamp',
          }
        );

        return (
          <div
            key={index}
            style={{
              position: 'absolute',
              width: circle.size,
              height: circle.size,
              borderRadius: '50%',
              background: 'white',
              opacity: opacity,
              transform: `translate(${circle.x}px, ${circle.y}px)`,
              pointerEvents: 'none',
            }}
          />
        );
      })}
    </>
  );
};
