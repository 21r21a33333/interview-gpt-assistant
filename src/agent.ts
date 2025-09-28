import {
  type JobContext,
  type JobProcess,
  WorkerOptions,
  cli,
  defineAgent,
  llm,
  metrics,
  voice,
} from '@livekit/agents';
import * as cartesia from '@livekit/agents-plugin-cartesia';
import * as deepgram from '@livekit/agents-plugin-deepgram';
import * as livekit from '@livekit/agents-plugin-livekit';
import * as silero from '@livekit/agents-plugin-silero';
import { BackgroundVoiceCancellation } from '@livekit/noise-cancellation-node';
import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import * as google from '@livekit/agents-plugin-google';



dotenv.config({ path: '.env.local' });

class Assistant extends voice.Agent {
  constructor() {
    super({
      instructions: `You are an interview candidate specializing in computer science, but you are also prepared to answer any general questions. Anyone can ask you computer science questions or any questions in general, and your responsibility is to answer them correctly and clearly. Respond as a knowledgeable, confident, and articulate candidate. If you do not know the answer, admit it honestly. Your answers should be accurate, concise, and free of unnecessary embellishments or complex formatting. Avoid using emojis, asterisks, or other symbols. Remain professional, friendly, and focused on providing correct information.

      If a user specifically asks for code, return only the code in a code block with the appropriate language (e.g., \`\`\`python), without any comments, explanations, or examples—just the code itself.

      If the user asks a theoretical question and the answer involves code, just mention the key steps or points about how the code would look or what it would do, but do not provide the full code. Only provide actual code if the user directly requests it. Since your responses are spoken by a text-to-speech model, giving complete code for theoretical questions doesn't make sense for an interview setting. For theory questions, answer in clear, casual terms and bullet points if helpful, focusing on concepts rather than code.`
    });
  }
}

export default defineAgent({
  prewarm: async (proc: JobProcess) => {
    proc.userData.vad = await silero.VAD.load();
  },
  entry: async (ctx: JobContext) => {
    // Set up a voice AI pipeline using OpenAI, Cartesia, Deepgram, and the LiveKit turn detector
    const session = new voice.AgentSession({

      llm: new google.LLM({
        model: "gemini-2.0-flash-exp",
      }),
      // Speech-to-text (STT) is your agent's ears, turning the user's speech into text that the LLM can understand
      // See all providers at https://docs.livekit.io/agents/integrations/stt/
      stt: new deepgram.STT({ model: 'nova-3' }),
      // Text-to-speech (TTS) is your agent's voice, turning the LLM's text into speech that the user can hear
      // See all providers at https://docs.livekit.io/agents/integrations/tts/
      tts: new cartesia.TTS({
        voice: '6f84f4b8-58a2-430c-8c79-688dad597532',
      }),
      // VAD and turn detection are used to determine when the user is speaking and when the agent should respond
      // See more at https://docs.livekit.io/agents/build/turns
      turnDetection: new livekit.turnDetector.MultilingualModel(),
      vad: ctx.proc.userData.vad! as silero.VAD,
    });

    // To use a realtime model instead of a voice pipeline, use the following session setup instead:
    // const session = new voice.AgentSession({
    //   // See all providers at https://docs.livekit.io/agents/integrations/realtime/
    //   llm: new openai.realtime.RealtimeModel({ voice: 'marin' }),
    // });

    // Metrics collection, to measure pipeline performance
    // For more information, see https://docs.livekit.io/agents/build/metrics/
    const usageCollector = new metrics.UsageCollector();
    session.on(voice.AgentSessionEventTypes.MetricsCollected, (ev) => {
      metrics.logMetrics(ev.metrics);
      usageCollector.collect(ev.metrics);
    });

    const logUsage = async () => {
      const summary = usageCollector.getSummary();
      console.log(`Usage: ${JSON.stringify(summary)}`);
    };

    ctx.addShutdownCallback(logUsage);

    // Start the session, which initializes the voice pipeline and warms up the models
    await session.start({
      agent: new Assistant(),
      room: ctx.room,
      inputOptions: {
        // LiveKit Cloud enhanced noise cancellation
        // - If self-hosting, omit this parameter
        // - For telephony applications, use `BackgroundVoiceCancellationTelephony` for best results
        noiseCancellation: BackgroundVoiceCancellation(),
      },
    });

    // Join the room and connect to the user
    await ctx.connect();
  },
});

cli.runApp(new WorkerOptions({ agent: fileURLToPath(import.meta.url) }));
