import {Composition, Folder, staticFile} from 'remotion';
import {HelloWorld} from './HelloWorld';
import {Logo} from './HelloWorld/Logo';
import {Subtitle} from './HelloWorld/Subtitle';
import {Title} from './HelloWorld/Title';
import {ProductLaunch} from './ProductLaunch';
import {Typography} from './Typography';
import {NeosisVideo} from './Neosis';

// Each "Composition" is a video to render
export const RemotionRoot: React.FC = () => {
  return (
    <>
      {/* Neosis - YHack 2026 Demo Reel */}
      <Composition
        id="Neosis"
        component={NeosisVideo}
        durationInFrames={1800}
        fps={60}
        width={1920}
        height={1080}
        defaultProps={{}}
      />

      {/* Product Launch - The Main Feature */}
      <Composition
        id="ProductLaunch"
        component={ProductLaunch}
        durationInFrames={900}
        fps={60}
        width={1920}
        height={1080}
        defaultProps={{
          titleText: 'Introducing',
          productName: 'Vision',
          tagline: 'The future, delivered.',
          releaseDate: 'Available This Fall',
        }}
      />

      {/* Typography Showcase */}
      <Composition
        id="Typography"
        component={Typography}
        durationInFrames={300}
        fps={60}
        width={1920}
        height={1080}
      />

      {/* Original HelloWorld examples */}
      <Folder name="examples">
        <Composition
          id="HelloWorld"
          component={HelloWorld}
          durationInFrames={150}
          fps={30}
          width={1920}
          height={1080}
          defaultProps={{
            titleText: 'Welcome to Remotion',
            titleColor: '#000000',
          }}
        />
        <Composition
          id="Logo"
          component={Logo}
          durationInFrames={150}
          fps={30}
          width={1920}
          height={1080}
        />
        <Composition
          id="Title"
          component={Title}
          durationInFrames={150}
          fps={30}
          width={1920}
          height={1080}
          defaultProps={{
            titleText: 'Welcome to Remotion',
            titleColor: 'black',
          }}
        />
        <Composition
          id="Subtitle"
          component={Subtitle}
          durationInFrames={150}
          fps={30}
          width={1920}
          height={1080}
        />
      </Folder>
    </>
  );
};
