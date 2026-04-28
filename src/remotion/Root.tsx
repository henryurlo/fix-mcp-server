import React from 'react';
import { Composition } from 'remotion';
import { ScenarioExecutiveBrief } from './ScenarioExecutiveBrief';
import { defaultStory, scenarioStories } from './scenarioStories';

const WIDTH = 1920;
const HEIGHT = 1080;
const FPS = 30;
const DURATION = 900;
const compositionId = (id: string) => `scenario-${id.replace(/_/g, '-')}`;

export function RemotionRoot() {
  return (
    <>
      <Composition
        id="ExecutiveScenarioDemo"
        component={ScenarioExecutiveBrief}
        durationInFrames={DURATION}
        fps={FPS}
        width={WIDTH}
        height={HEIGHT}
        defaultProps={{ story: defaultStory }}
      />
      {scenarioStories.map((story) => (
        <Composition
          key={story.id}
          id={compositionId(story.id)}
          component={ScenarioExecutiveBrief}
          durationInFrames={DURATION}
          fps={FPS}
          width={WIDTH}
          height={HEIGHT}
          defaultProps={{ story }}
        />
      ))}
    </>
  );
}
