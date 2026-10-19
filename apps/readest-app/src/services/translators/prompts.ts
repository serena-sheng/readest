// TypeScript port of the local expert service's prompt builders
// (`commonreader-ai/translation.py` + `prompts.py`), used when the active
// translation endpoint is an OpenAI-compatible chat API instead of the local
// service. Keeping the same text means switching backends changes the
// transport, not the translation instructions.
//
// Five genres × three modes; the style id is `<genre>.<mode>`, e.g.
// `humanities.faithful`. Unknown or legacy ids fall back to the same pairs as
// the service, so a hand-edited `emm.translationStyle` never yields an empty
// system prompt.

const LANG_LINE = '请使用简体中文输出。';

const DEFAULT_CONTRACT = 'JSON object only: {"paragraphs":[{"id":1,"text":"..."}]}';

interface GenreSpec {
  label: string;
  desc: string;
  profile: string;
}

interface ModeSpec {
  label: string;
  desc: string;
  temp: number;
  rules: string;
}

export const TRANSLATION_GENRES: Record<string, GenreSpec> = {
  adult: {
    label: '成人小说',
    desc: '身体与心理描写的节奏、语气克制',
    profile:
      '你是成人文学的译者，熟悉这类文本的叙事节奏与分寸。\n## 题材规则\n' +
      '1. 身体与情欲描写按原文强度处理：该直白就直白，该迂回就迂回，不额外加戏也不故意淡化。\n' +
      '2. 保留叙述者的视角与羞耻、迟疑、试探这类心理层次；不要写成说明书。\n' +
      '3. 人物说话要能分出性格与关系远近，称呼前后一致。\n' +
      '4. 不添加原文没有的性描写，不把含蓄处改写成露骨。',
  },
  jp_doujin: {
    label: '日系成人同人',
    desc: '日式语感、称呼、拟声词',
    profile:
      '你是日文成人向小说的译者，熟悉同人志与成人轻小说的语感。\n## 题材规则\n' +
      '1. 称呼（さん／ちゃん／先輩／くん／様）与第一人称（僕／俺／私／あたし）保留层级差异，不统一抹平。\n' +
      '2. 拟声、拟态与语气词（あっ、んっ、はぁ…）保留节奏，不省略成一句概述。\n' +
      '3. 敬语与粗俗语的落差照实体现；性相关词汇按原文尺度选择对应中文。\n' +
      '4. 角色口癖一一对应，不用中文方言替换日式方言。',
  },
  jp_light: {
    label: '日本轻小说',
    desc: '口语、吐槽、角色口吻',
    profile:
      '你是日本轻小说的译者，熟悉校园／异世界类作品的叙述腔调。\n## 题材规则\n' +
      '1. 叙述与对话保持轻快口语，吐槽不写成书面议论。\n' +
      '2. 角色口癖、敬称、绰号必须区分并全篇一致。\n' +
      '3. 技能名、专有名词按通行译法；首次出现可括注原文。\n' +
      '4. 拟声词短促处理，不扩写成描写。',
  },
  humanities: {
    label: '人文社科',
    desc: '论证连接、概念精确、引文照译',
    profile:
      '你是人文社科学术译者，熟悉哲学、社会学与思想史的论证文体。\n## 题材规则\n' +
      '1. 术语准确性优先于流畅；关键概念首次出现用「译名（原词）」，此后统一。\n' +
      '2. 显化论证连接（因此、然而、正因如此），不省略限定词与让步结构。\n' +
      '3. 引文、斜体、书名保持原样，不意译。\n' +
      '4. 不以中文成语替换原文的概念表达。',
  },
  psych: {
    label: '心理学学术',
    desc: '临床与实证术语、谨慎表述',
    profile:
      '你是心理学与临床研究文献的译者，熟悉实证论文与临床描述的写法。\n## 题材规则\n' +
      '1. 诊断、量表、统计术语用通行译名（DSM、CBT、效应量等），首次括注原文。\n' +
      '2. 保留原文的谨慎表述（可能、与…相关、提示），不把相关性译成因果。\n' +
      '3. 被试、样本、条件、效应等词严格区分。\n' +
      '4. 涉及症状与创伤的描述保持克制，不渲染。',
  },
};

export const TRANSLATION_MODES: Record<string, ModeSpec> = {
  faithful: {
    label: '忠实原文',
    desc: '贴句子结构，术语与称呼不折损',
    temp: 0.3,
    rules:
      '1. 仅输出译文，不解释、不加评注、不添加原文没有的信息。\n' +
      '2. 保持原文句序与逻辑连接词；不合并、不拆分句子。\n' +
      '3. 术语、称呼、敬语层级、口癖一律不折损；首次出现可用括号给原词。\n' +
      '4. 比喻照译，不换成中文成语；原文的重复与停顿保留。',
  },
  plain: {
    label: '通俗易懂',
    desc: '长句拆短，用现代口语讲明白',
    temp: 0.55,
    rules:
      '1. 仅输出译文，不加解释性句子。\n' +
      '2. 长句拆短，一句话只讲一件事；把抽象名词落回具体动作。\n' +
      '3. 可以补极短衔接词让逻辑显形，但不添加原文没有的信息。\n' +
      '4. 不用文言腔、术语堆叠和翻译腔。',
  },
  learn: {
    label: '语言学习',
    desc: '译文可读，另附词汇与地道用语',
    temp: 0.45,
    rules:
      '1. 先给出完整、可以直接读下去的译文；译文里不要插注释、括号解释或原文。\n' +
      '2. 每段另附最多 3 条学习点，优先「地道用语」——固定搭配、惯用句式、语气词、俚语，' +
      '其次才是生僻词；不要挑随处可见的基础词。\n' +
      '3. 每条写清楚：原词、读音（日文假名或英文音标，可省）、中文含义、什么场合用。\n' +
      '4. 同一个词全篇只讲一次；宁可少讲，不要凑数。\n' +
      '5. 学习点属于辅助信息，不能改变译文的通顺度。',
  },
};

export const TRANSLATION_CONTRACTS: Record<string, string> = {
  faithful: DEFAULT_CONTRACT,
  plain: DEFAULT_CONTRACT,
  learn:
    'JSON object only: {"paragraphs":[{"id":1,"text":"译文","notes":[{"term":"原词",' +
    '"reading":"读音或音标","meaning":"中文含义","kind":"idiom|collocation|grammar|vocab",' +
    '"usage":"什么场合用"}]}]}',
};

export const DEFAULT_TRANSLATION_STYLE = 'humanities.faithful';

const LEGACY_STYLES: Record<string, string> = {
  faithful: 'humanities.faithful',
  academic: 'humanities.faithful',
  literary: 'adult.faithful',
  plain: 'humanities.plain',
  classical: 'humanities.faithful',
  dialect: 'jp_light.plain',
};

/**
 * Split `<genre>.<mode>` with the same fallbacks as the service: an unknown
 * pair uses the default, and the legacy single-word ids still map.
 */
export const parseTranslationStyle = (styleId?: string | null): { genre: string; mode: string } => {
  const id = (styleId ?? '').trim();
  const [genre, mode] = id.split('.');
  if (genre && mode && TRANSLATION_GENRES[genre] && TRANSLATION_MODES[mode]) {
    return { genre, mode };
  }
  const legacy = LEGACY_STYLES[id];
  if (legacy) {
    const [legacyGenre, legacyMode] = legacy.split('.');
    return { genre: legacyGenre!, mode: legacyMode! };
  }
  return { genre: 'humanities', mode: 'faithful' };
};

/** The JSON contract the model must follow for this style's mode. */
export const contractFor = (styleId?: string | null): string =>
  TRANSLATION_CONTRACTS[parseTranslationStyle(styleId).mode] ?? DEFAULT_CONTRACT;

/**
 * Build the system prompt for a style, optionally with the service's glossary
 * pairs (`原词 → 译名`) and a per-book override.
 */
export const systemPromptFor = (
  styleId?: string | null,
  glossary?: Record<string, string>,
  override?: string,
): string => {
  const { genre, mode } = parseTranslationStyle(styleId);
  const parts = [
    TRANSLATION_GENRES[genre]!.profile,
    '## 翻译规则\n' + TRANSLATION_MODES[mode]!.rules,
    LANG_LINE,
    '标签和任何选中起止标记都是机器定位信息：输出中不要复述、翻译或改写它们，必须原样保留。',
  ];
  const glossaryLines = Object.entries(glossary ?? {}).filter(
    ([source, target]) => source.trim() && target.trim(),
  );
  if (glossaryLines.length) {
    parts.push(
      '## 术语表（强制采用，优先级高于自由发挥）\n' +
        glossaryLines.map(([source, target]) => `- ${source} → ${target}`).join('\n'),
    );
  }
  if (override?.trim()) {
    parts.push('## 附加要求（优先级高于上文的同义倾向）\n' + override.trim());
  }
  return parts.join('\n\n');
};

/**
 * The user message for one batch. Paragraph ids are 1-based request
 * positions, which is what the response is mapped back by.
 */
export const translateRequest = (
  paragraphs: string[],
  target = '简体中文',
  contract = '',
): string => {
  const body = paragraphs
    .map((paragraph, index) => `<p id="${index + 1}">${paragraph}</p>`)
    .join('\n');
  return (
    `<translate_request target="${target}">\n` +
    '<task>translate_book_paragraphs</task>\n' +
    '<rules>逐段翻译；保持段落一一对应；不要合并或拆分段落；输出 JSON。</rules>\n' +
    `<output_format>${contract || DEFAULT_CONTRACT}</output_format>\n` +
    `<content>\n${body}\n</content>\n` +
    '</translate_request>'
  );
};
