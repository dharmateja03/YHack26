import React from 'react';
import {
  AbsoluteFill,
  Easing,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';

interface ProductRevealProps {
  productName: string;
  tagline: string;
}

export const ProductReveal: React.FC<ProductRevealProps> = ({
  productName,
  tagline,
}) => {
  const frame = useCurrentFrame();
  const {fps, durationInFrames} = useVideoConfig();

  // Black screen fade from previous scene
  const blackScreenOpacity = interpolate(
    frame,
    [0, 20],
    [0, 0.3],
    {
      easing: Easing.bezier(0.4, 0, 0.2, 1),
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    }
  );

  // Product name fade in
  const nameOpacity = interpolate(
    frame,
    [20, 50],
    [0, 1],
    {
      easing: Easing.bezier(0.4, 0, 0.2, 1),
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    }
  );

  // Product name slide up
  const nameY = spring({
    fps,
    frame: frame - 20,
    config: {
      damping: 20,
      mass: 1,
      stiffness: 100,
    },
  });

  // Tagline fade in
  const taglineOpacity = interpolate(
    frame,
    [60, 90],
    [0, 1],
    {
      easing: Easing.bezier(0.4, 0, 0.2, 1),
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    }
  );

  // Tagline slide up
  const taglineY = spring({
    fps,
    frame: frame - 60,
    config: {
      damping: 20,
      mass: 1,
      stiffness: 100,
    },
  });

  // Product image/icon reveal
  const iconScale = spring({
    fps,
    frame: frame - 40,
    config: {
      damping: 15,
      mass: 1,
      stiffness: 120,
    },
  });

  const iconOpacity = interpolate(
    frame,
    [40, 80],
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
    <>
      {/* Black overlay for drama */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          backgroundColor: 'black',
          opacity: blackScreenOpacity,
          pointerEvents: 'none',
        }}
      />

      <AbsoluteFill
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          opacity: fadeOut,
          background: 'radial-gradient(circle at center, #FAFAFA 0%, #F0F0F0 100%)',
        }}
      >
        {/* Icon/Logo representation */}
        <div
          style={{
            width: 200,
            height: 200,
            borderRadius: 48,
            background: 'linear-gradient(135deg, #007AFF 0%, #5856D6 100%)',
            opacity: iconOpacity,
            transform: `scale(${interpolate(iconScale, [0, 1], [0.5, 1])})`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 40px 80px rgba(0, 122, 255, 0.3), 0 0 0 1px rgba(255,255,255,0.1)',
            marginBottom: 60,
          }}
        >
          {/* Stylized V */}
          <div
            style={{
              fontSize: 96,
              fontWeight: 700,
              color: 'white',
              letterSpacing: '-0.02em',
              lineHeight: 1,
            }}
          >
            V
          </div>
        </div>

        {/* Product Name */}
        <div
          style={{
            fontSize: 120,
            fontWeight: 700,
            color: '#1D1D1F',
            letterSpacing: '-0.04em',
            opacity: nameOpacity,
            transform: `translateY(${interpolate(nameY, [0, 1], [30, 0])}px)`,
            lineHeight: 1,
            marginBottom: 24,
          }}
        >
          {productName}
        </div>

        {/* Tagline */}
        <div
          style={{
            fontSize: 48,
            fontWeight: 400,
            color: '#86868B',
            letterSpacing: '-0.01em',
            opacity: taglineOpacity,
            transform: `translateY(${interpolate(taglineY, [0, 1], [20, 0])}px)`,
            lineHeight: 1.2,
          }}
        >
          {tagline}
        </div>
      </AbsoluteFill>
    </>
  );
};
