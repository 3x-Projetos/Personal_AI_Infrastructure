# PAI Voice System - Future Improvements

## Opção B: Fine-tuning LoRA para PT-BR (Prioridade Alta)

**Status:** Planejado
**Estimativa:** 2-4 horas de setup + tempo de treino

### Objetivo
Fine-tune do modelo S1-mini com LoRA para melhorar qualidade de clonagem PT-BR.

### Requisitos
- ~1 hora de áudio PT-BR do speaker alvo (ElevenLabs)
- GPU com VRAM suficiente (RTX 3090+ recomendado)
- ~10.000 steps de treino

### Referências
- [GitHub Discussion #794](https://github.com/fishaudio/fish-speech/discussions/794) - Usuário reportou sucesso com LoRA
- Fish Speech suporta fine-tuning: `fish_speech/models/text2semantic/`

### Passos Planejados
1. Gerar ~60 clips de áudio (1 minuto cada) via ElevenLabs
2. Transcrever todos os áudios
3. Preparar dataset no formato Fish Speech
4. Treinar LoRA adapter
5. Integrar adapter no voice server

### Notas da Comunidade
> "Fine-tuning a LoRA model with an hour of speech data per speaker produces pretty good quality"
> - GitHub Discussion #794

---

## Opção C: Híbrido Inteligente (Prioridade Média)

**Status:** Considerado
**Complexidade:** Baixa

### Conceito
- Fish Audio para EN (funciona bem nativamente)
- ElevenLabs para PT-BR (qualidade garantida)
- Detecção automática de idioma no texto

### Implementação
```typescript
function detectLanguage(text: string): 'pt-br' | 'en' {
  // Detectar por caracteres acentuados, palavras comuns, etc.
}

async function generateSpeech(text: string) {
  const lang = detectLanguage(text);
  if (lang === 'pt-br') {
    return generateElevenLabs(text);
  }
  return generateFishAudio(text);
}
```

---

## Modelo S1-full (4B) - Monitorar

**Status:** Não disponível publicamente
**Ação:** Monitorar releases do Fish Audio

O modelo de 4B parâmetros oferece:
- WER: 0.008 (vs 0.011 do mini)
- Speaker Distance: 0.332 (vs 0.380 do mini)

Se for liberado publicamente, considerar migração.

---

*Criado: 2026-01-12*
*Última atualização: 2026-01-12*
