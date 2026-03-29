import React from 'react';
import {
  AbsoluteFill,
  Easing,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';

interface IntroSlideProps {
  titleText: string;
  productName: string;
}

export const IntroSlide: React.FC<IntroSlideProps> = ({
  titleText,
  productName,
}) => {
  const frame = useCurrentFrame();
  const {fps, durationInFrames} = useVideoConfig();

  // Fade in "Introducing"
  const titleOpacity = interpolate(
    frame,
    [0, 30],
    [0, 1],
    {
      easing: Easing.bezier(0.4, 0, 0.2, 1),
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    }
  );

  // Slide up "Introducing"
  const titleY = interpolate(
    frame,
    [0, 30],
    [50, 0],
    {
      easing: Easing.bezier(0.4, 0, 0.2, 1),
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    }
  );

  // Scale up product name
  const productScale = interpolate(
    frame,
    [30, 90],
    [0.8, 1],
    {
      easing: Easing.bezier(0.34, 1.56, 0.64, 1),
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    }
  );

  // Fade in product name
  const productOpacity = interpolate(
    frame,
    [30, 60],
    [0, 1],
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
        opacity: fadeOut,
      }}
    >
      {/* "Introducing" - subtle, elegant */}
      <div
        style={{
          fontSize: 64,
          fontWeight: 400,
          color: '#86868B',
          letterSpacing: '0.05em',
          opacity: titleOpacity,
          transform: `translateY(${titleY}px)`,
          textTransform: 'uppercase',
          marginBottom: 32,
        }}
      >
        {titleText}
      </div>

      {/* Product Name - Bold, confident */}
      <div
        style={{
          fontSize: 180,
          fontWeight: 700,
          color: '#1D1D1F',
          letterSpacing: '-0.03em',
          opacity: productOpacity,
          transform: `scale(${productScale})`,
          lineHeight: 1,
        }}
      >
        {productName}
      </div>

      {/* Subtle gradient line animation */}
      <GradientLine frame={frame} />
    </AbsoluteFill>
  );
};

const GradientLine: React.FC<{frame: number}> = ({frame}) => {
  const width = interpolate(
    frame,
    [60, 120],
    [0, 200],
    {
      easing: Easing.bezier(0.4, 0, 0.2, 1),
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    }
  );

  const opacity = interpolate(
    frame,
    [120, 150],
    [1, 0],
    {
      easing: Easing.bezier(0.4, 0, 0.2, 1),
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    }
  );

  return (
    <div
      style={{
        width: width,
        height: 2,
        background: 'linear-gradient(90deg, transparent, #1D1D1F, transparent)',
        marginTop: 60,
        opacity: opacity,
      }}
    />
  );
};
