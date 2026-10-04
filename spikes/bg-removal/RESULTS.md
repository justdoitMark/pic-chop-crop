# Удаление фона — результаты спайка

План и пороги: `docs/superpowers/plans/2026-10-04-bg-removal-spike.md` (пороги не менялись).
Сырые данные: `out/results.csv` (не в git — рядом с фото).

**Статус:** этапы A–B на синтетике; ждём 10 реальных фото.

## Машина

| | |
|---|---|
| Ноутбук | Intel Core i7-1185G7, Intel Iris Xe (драйвер 32.0.101.7088), 15,7 ГБ ОЗУ, Windows 10 Pro 19045 |
| Свободно ОЗУ при замерах | ~6 ГБ (открыты VS Code, браузер, Claude) |
| Python / ORT | 3.13.13, `onnxruntime-directml` 1.24.4, провайдеры `DmlExecutionProvider`, `CPUExecutionProvider` |

## Модели: предобработка и входы/выходы

Из `preprocessor_config.json` и `session.get_inputs()/get_outputs()` (`bench.py --inspect`):

| Модель | Лицензия (карточка HF) | Вход | rescale | mean / std | Ресайз | Выход | Сигмоида |
|---|---|---|---|---|---|---|---|
| isnet | **AGPL-3.0** | `input` [1,3,1024,1024] f32 | нет | 128 / 256 | bilinear | `output` [1,1,1024,1024] f32 | не нужна |
| birefnet_lite | MIT | `input_image` [1,3,1024,1024] f32 | 1/255 | ImageNet | bilinear | `output_image` [1,1,1024,1024] f32 | _TBD_ |
| birefnet | MIT | `input_image` [1,3,1024,1024] f32 | 1/255 | ImageNet | bilinear | `output_image` [1,1,1024,1024] f32 | _TBD_ |
| ben2 | MIT | `pixel_values` [1,3,1024,1024] f32 | 1/255 | ImageNet | bilinear | `alphas` [1,1,1024,1024] f32 | _TBD_ |

ImageNet = mean (0.485, 0.456, 0.406), std (0.229, 0.224, 0.225). У fp16-файлов вход и выход тоже float32 (fp16 только внутри графа).

Проверка конвейера: синтетические фото с известной маской (`make_synthetic.py`, `check_synthetic.py`), в том числе с EXIF Orientation=6. ISNet fp32 DML: IoU 0,997 на обоих. Проверка падает на подложенной пустой/повёрнутой маске (exit 1).

## Размеры

| Файл | МБ |
|---|---|
| isnet fp32 / fp16 | 168,0 / 84,0 |
| birefnet_lite fp32 / fp16 | 213,6 / 109,2 |
| birefnet fp32 / fp16 | 927,6 / 467,0 |
| ben2 fp16 (fp32 в onnx-community нет) | 209,0 |
| `onnxruntime.dll` 1.24.4 (NuGet `Microsoft.ML.OnnxRuntime.DirectML`) | 16,5 |
| `DirectML.dll` 1.15.4 (NuGet `Microsoft.AI.DirectML`, `bin/x64-win`) | 17,7 |
| `onnxruntime_providers_shared.dll` | 0,02 |

## Отступления от плана

- **`ort` и версия ORT.** `ort 2.0.0-rc.13` по умолчанию собран под ONNX Runtime 1.28 (`api-27` в default-фичах), а последний DirectML-пакет на NuGet — 1.24.4. Поэтому `default-features = false` и фичи `std`, `load-dynamic`, `directml`, `ndarray`, **`api-24`**.
- **CPU-замеры:** на CPU только первые 3 фото и медиана 3 повторов (на DML — все фото и медиана 5). Для CPU нужен только тайминг; маски для оценки берутся с DML. Причина — один прогон BiRefNet на CPU занимает десятки секунд.
- **Таймаут 10 мин на комбинацию:** прогон, ушедший в своп, записывается как `timeout`, а не как время.
