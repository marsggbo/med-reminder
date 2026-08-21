// ── 中文药品信息解析：规则引擎（默认）+ LLM JSON 提取（可选联网）────────
// 从 OCR 原文提取：药品名称 / 每次用量 / 单位 / 每日次数 / 疗程天数 / 医嘱。
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.Parser = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {

  var UNITS = ['毫克', '克', '毫升', '片', '粒', '丸', '袋', '支', '包', '瓶', '颗', '滴', 'mg', 'ml', 'g'];

  var CN_DIGITS = { '零': 0, '一': 1, '二': 2, '两': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9, '十': 10 };

  function normalize(s) {
    return (s || '')
      .replace(/[\uFF01-\uFF5E]/g, function (ch) { return String.fromCharCode(ch.charCodeAt(0) - 0xFEE0); })
      .replace(/\u3000/g, ' ')
      .replace(/[ \t]+/g, ' ');
  }

  // "十五" → 15, "3" → 3, "半" → 0.5
  function cnToNum(s) {
    if (/^\d+(\.\d+)?$/.test(s)) return parseFloat(s);
    if (s === '半' || s === '半片' || s === '半粒') return 0.5;
    var total = 0, section = 0;
    for (var i = 0; i < s.length; i++) {
      var ch = s[i];
      if (ch === '十') { section = (section || 1) * 10; }
      else if (CN_DIGITS[ch] !== undefined) {
        if (ch === '十') continue;
        section += CN_DIGITS[ch];
      } else {
        total += section; section = 0;
      }
    }
    return total + section || 0;
  }

  function numToString(n) {
    if (!n) return '';
    return (Math.round(n * 10) / 10).toString();
  }

  // dedupe preserving order
  function dedupe(arr) { return arr.filter(function (v, i) { return arr.indexOf(v) === i; }); }

  function execAll(re, text) {
    var m, out = [];
    re.lastIndex = 0;
    while ((m = re.exec(text)) !== null) {
      out.push(m);
      if (m.index === re.lastIndex) re.lastIndex++;
    }
    return out;
  }

  // ── field extractors ─────────────────────────────────────────────────────
  function extractDose(text) {
    // 一次1片/一片(粒/丸/袋/支/g/mg/ml...)
    var unitRe = '(' + UNITS_escaped() + ')';
    var re = new RegExp('(?:一次|每次|单次|顿服)\\s*(?:服用|口服|用量|服药|服下|服)?\\s*' +
      '([0-9]+(?:\\.[0-9]+)?|[一二两三四五六七八九十零]{1,3}|半)\\s*' + unitRe + '?', 'g');
    var hits = execAll(re, text);
    for (var i = 0; i < hits.length; i++) {
      var num = cnToNum(hits[i][1]);
      var unit = hits[i][2] || inferUnitFromContext(text);
      if (num > 0) return { dose: num, unit: unit || '片', raw: hits[i][0] };
    }
    // "一次一片半" / "半片"
    var reHalf = /(?:一次|每次)\s*半\s*片|半\s*片/.exec(text);
    if (reHalf) return { dose: 0.5, unit: '片', raw: reHalf[0] };
    return null;
  }

  function inferUnitFromContext(text) {
    for (var i = 0; i < UNITS_FULL_SCAN.length; i++) {
      if (text.indexOf(UNITS_FULL_SCAN[i]) !== -1) return UNITS_FULL_SCAN[i];
    }
    return null;
  }

  function UNITS_reg() { return UNITS.sort(function (a, b) { return b.length - a.length; }).join('|'); }
  function UNITS_escaped() { return UNITS.sort(function (a, b) { return b.length - a.length; }).map(function (u) { return u.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }).join('|'); }
  var UNITS_FULL_SCAN = ['毫克', '毫升', '克', 'mg', 'ml', 'g', '片', '粒', '丸', '袋', '支', '包', '瓶', '颗', '滴'];

  function extractTimes(text) {
    var re = /(?:一日|每日|每天|1日|日|一天)([一二两三四五六七八九十\d]+)\s*(?:次|顿)/g;
    var hits = execAll(re, text);
    var n = 0;
    hits.forEach(function (m) { n = Math.max(n, cnToNum(m[1])); });
    // 分X次服用
    var m2 = /分([一二两三四五六七八九十\d]+)\s*次/.exec(text);
    if (m2) n = Math.max(n, cnToNum(m2[1]));
    // bid/tid/qd
    if (!n) {
      if (/[qQ]\s?\.?\s?[dD]/.test(text)) n = 1;
      if (/[bB]\s?\.?\s?[iI]\s?\.?\s?[dD]/.test(text)) n = 2;
      if (/[tT]\s?\.?\s?[iI][dD]/.test(text)) n = 3;
    }
    return n || 0;
  }

  function extractDuration(text) {
    var re = /(?:疗程|连用|连服|服用|用药)[为的]?([一二两三四五六七八九十\d]+)\s*(?:天|日)(?!以上)/g;
    var m = execAll(re, text).map(function (x) { return cnToNum(x[1]); });
    var n = 0;
    m.forEach(function (v) { n = Math.max(n, v); });
    return n || 0;
  }

  var INSTR_TOKENS = [
    '饭后半小时', '饭前半小时', '饭后', '饭前', '睡前', '睡前服用', '晨起', '起床后', '空腹',
    '随餐', '嚼服', '含服', '吞服', '温水送服', '开水送服', '口服液摇匀', '用前摇匀',
    '多喝水', '足量饮水', '餐中', '两餐之间'
  ];

  function extractInstructions(text) {
    var found = [];
    INSTR_TOKENS.sort(function (a, b) { return b.length - a.length; }).forEach(function (tok) {
      if (text.indexOf(tok) !== -1) found.push(tok);
    });
    return dedupe(found).join('、');
  }

  function extractName(lines) {
    // 1) 结构化标题行
    for (var i = 0; i < lines.length; i++) {
      var m = /(?:【)?药品名称|通用名称|商品名称|品名/.exec(lines[i]);
      if (m) {
        var rest = lines[i].split(/[:：]/)[1];
        if (rest) {
          var candidate = rest.replace(/[【】\[\]()（）.\s]/g, '').trim();
          if (candidate.length >= 2) return candidate;
        }
      }
    }
    // 2) 逐行候选：短行、含≥2 个汉字、非数字/日期/关键字开头
    var skipWords = ['用法', '规格', '适应', '不良', '禁忌', '注意', '贮藏', '生产', '批准', '剂量',
      '一日', '一次', '每日', '每次', '口服', '用量', '成人', '儿童', '老年', '新生儿', '孕妇', '哺乳',
      '过量', '警示', '有效期', '储存', '保存', '包装', '咨询', '本品', '性状', '药代', '临床试验',
      '相互作用', '药理', '毒理', '上市', '注册', '分类', '执行标准', '电话', '网址', '说明书', '日期'];
    var numRe = /^[0-9一二两三四五六七八九十][0-9.：:]*/;
    for (var j = 0; j < Math.min(lines.length, 8); j++) {
      var line = lines[j].replace(/[【】\[\]()（）\"'“”‘’*＊#]/g, ' ').trim();
      if (!line) continue;
      var cjk = (line.match(/[\u4e00-\u9fa5]/g) || []).length;
      if (cjk < 2 || line.length > 18) continue;
      if (numRe.test(line)) continue;
      var skip = false;
      for (var k = 0; k < skipWords.length; k++) {
        if (line.indexOf(skipWords[k]) !== -1) { skip = true; break; }
      }
      if (skip) continue;
      if (/(胶囊|片剂|片|颗粒|口服液|合剂|丸|散|膏|贴|滴眼|软膏|凝胶|注射液|滴丸)/.test(line)) {
        return line;
      }
    }
    return '';
  }

  // ── main ─────────────────────────────────────────────────────────────────
  function extract(text) {
    var lines = normalize(text).split('\n').map(function (s) { return s.trim(); }).filter(Boolean);
    var whole = lines.join(' ');
    var name = extractName(lines);
    var doseInfo = extractDose(whole);
    var times = extractTimes(whole);
    var duration = extractDuration(whole);
    var instructions = extractInstructions(whole);

    var fields = {
      name: name,
      dosePerTime: doseInfo ? doseInfo.dose : null,
      doseUnit: doseInfo ? doseInfo.unit : null,
      timesPerDay: times || null,
      durationDays: duration || null,
      instructions: instructions || null
    };

    // confidence: 4 required-ish fields (name/dose/times) weighted
    var named = !!fields.name;
    var haveDose = !!fields.dosePerTime, haveTimes = !!fields.timesPerDay, haveDur = !!fields.durationDays;
    var score = (named ? 0.35 : 0) + (haveDose ? 0.25 : 0) + (haveTimes ? 0.25 : 0) + (haveDur ? 0.15 : 0);
    fields.confidence = score >= 0.75 ? 'high' : score >= 0.45 ? 'medium' : 'low';
    fields.rawText = text;
    return fields;
  }

  // ── LLM extractor（可选，联网，免费额度 API）──────────────────────────────
  var SYSTEM_PROMPT = [
    '你是药品说明书信息抽取助手。根据用户提供的 OCR 文本，提取以下 JSON 字段：',
    '{"name": "药品名称", "dosePerTime": 每次用量数字, "doseUnit": "片/粒/克/mg/ml", "timesPerDay": 每日次数数字, "durationDays": 疗程天数数字, "instructions": "医嘱短语，无则空字符串"}',
    '规则：dosePerTime/timesPerDay/durationDays 只输出数字或 0；找不到的字段用 null；只输出 JSON 本身，不要任何解释。'
  ].join('\n');

  function extractWithLLM(text, cfg) {
    var url = (cfg.baseUrl || 'https://api.deepseek.com/v1').replace(/\/+$/, '') + '/chat/completions';
    var body = {
      model: cfg.model || 'deepseek-chat',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: '请从下面的药品说明文字中抽取字段：\n' + text }
      ],
      temperature: 0.1
    };
    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timeout = setTimeout(function () { if (ctrl) ctrl.abort(); }, 30000);
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + cfg.apiKey },
      body: JSON.stringify(body),
      signal: ctrl ? ctrl.signal : undefined
    }).then(function (r) {
      clearTimeout(timeout);
      if (!r.ok) throw new Error('AI 解析失败（HTTP ' + r.status + '）');
      return r.json();
    }).then(function (json) {
      var content = json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.content;
      if (!content) throw new Error('AI 无返回内容');
      var parsed = JSON.parse(content.replace(/```(?:json)?/g, '').replace(/(^[^\{]*|\}]*$)/g, '').trim());
      return normalizeFields(parsed, text);
    });
  }

  function normalizeFields(llm, text) {
    var fields = {
      name: (llm.name || '').toString().trim() || null,
      dosePerTime: toNumNull(llm.dosePerTime),
      doseUnit: (llm.doseUnit || '').toString().trim() || null,
      timesPerDay: toNumIntNull(llm.timesPerDay),
      durationDays: toNumIntNull(llm.durationDays),
      instructions: (llm.instructions || '').toString().trim() || null,
      confidence: 'medium',
      source: 'llm'
    };
    fields.rawText = text;
    return fields;
  }

  function toNumNull(v) {
    if (v === null || v === undefined || v === '') return null;
    var n = parseFloat(String(v).replace(/[^0-9.]/g, ''));
    return isNaN(n) ? null : n;
  }
  function toNumIntNull(v) {
    var n = toNumNull(v);
    return n === null ? null : Math.round(n);
  }

  return {
    extract: extract,
    extractWithLLM: extractWithLLM,
    _cnToNum: cnToNum
  };
});