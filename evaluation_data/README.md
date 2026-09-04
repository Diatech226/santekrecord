# Dataset de validation radio

Ce répertoire est volontairement vide : WAV et annotations peuvent contenir des
communications sensibles et sont ignorés par Git.

## Procédure réelle

1. Collecter **20 à 50 communications** dans les conditions acoustiques réelles.
2. Copier les PCM-16 WAV dans `evaluation_data/audio/`.
3. Ouvrir **Review** dans l'historique, corriger les bornes, scinder/fusionner les
   transmissions et renseigner le locuteur manuel. Placer le JSON téléchargé dans
   `evaluation_data/annotations/` et vérifier que `file` désigne le WAV.
4. Annoter dans `events` : `ambient`, `radio_hiss`, `beep`, `speech`,
   `door_noise` ou `other_noise`.
5. Lancer `evaluate`, puis examiner les trois rapports dans `evaluation_results/`.
6. Lancer `tune --trials 50` et examiner `recommended_config.json`.
7. Tester manuellement la recommandation sur le live. Le tuner ne modifie jamais
   `data/config.json`.

## Schéma minimal

```json
{
  "schema_version": 1,
  "file": "example001.wav",
  "sample_rate": 16000,
  "communications": [{
    "id": "GT-COM-001", "start_sec": 2.4, "end_sec": 24.7,
    "transmissions": [{
      "id": 1, "start_sec": 2.8, "end_sec": 7.1, "speaker": "A",
      "speech_segments": [{"start_sec": 3.0, "end_sec": 4.6}]
    }]
  }],
  "events": [{"start_sec": 0.0, "end_sec": 2.2, "type": "ambient"}]
}
```

Le parseur et l'UI conservent aussi `start_sample`/`end_sample`. Le locuteur est
libre (`Unknown`, A–D ou texte) et aucune diarisation automatique n'est réalisée.
