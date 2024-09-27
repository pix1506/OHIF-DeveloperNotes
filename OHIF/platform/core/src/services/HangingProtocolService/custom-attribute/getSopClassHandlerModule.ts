import { utils } from '@ohif/core';
import { metaData, cache, triggerEvent, eventTarget } from '@cornerstonejs/core';
import { CONSTANTS } from '@cornerstonejs/tools';
import { adaptersSEG, Enums } from '@cornerstonejs/adapters';

import { SOPClassHandlerId } from './id';
import { dicomlabToRGB } from './utils/dicomlabToRGB';

const sopClassUids = ['1.2.840.10008.5.1.4.1.1.66.4'];
console.log('metadata:', JSON.parse(JSON.stringify(metaData)));
const loadPromises = {};

function _getDisplaySetsFromSeries(
  instances,
  servicesManager: AppTypes.ServicesManager,
  extensionManager
) {
  const instance = instances[0];

  const {
    StudyInstanceUID,
    SeriesInstanceUID,
    SOPInstanceUID,
    SeriesDescription,
    SeriesNumber,
    SeriesDate,
    SOPClassUID,
    wadoRoot,
    wadoUri,
    wadoUriRoot,
  } = instance;

  console.log('instance:', JSON.parse(JSON.stringify(instance)));

  const displaySet = {
    Modality: 'SEG',
    loading: false,
    isReconstructable: true, // by default for now since it is a volumetric SEG currently
    displaySetInstanceUID: utils.guid(),
    SeriesDescription,
    SeriesNumber,
    SeriesDate,
    SOPInstanceUID,
    SeriesInstanceUID,
    StudyInstanceUID,
    SOPClassHandlerId,
    SOPClassUID,
    referencedImages: null,
    referencedSeriesInstanceUID: null,
    referencedDisplaySetInstanceUID: null,
    isDerivedDisplaySet: true,
    isLoaded: false,
    isHydrated: false,
    segments: {},
    sopClassUids,
    instance,
    instances: [instance],
    wadoRoot,
    wadoUriRoot,
    wadoUri,
    isOverlayDisplaySet: true,
  };
  if (!displaySet || Object.keys(displaySet).length === 0) {
    console.log('fail');
  } else {
    console.log('初始的 DisplaySet v1.0:', JSON.parse(JSON.stringify(displaySet)));
  }
  console.log('初始的 instance:', JSON.parse(JSON.stringify(instance)));
  const referencedSeriesSequence = instance.ReferencedSeriesSequence;

  if (!referencedSeriesSequence) {
    console.error('ReferencedSeriesSequence is missing for the SEG');
    return;
  }

  const referencedSeries = referencedSeriesSequence[0] || referencedSeriesSequence;

  displaySet.referencedImages = instance.ReferencedSeriesSequence.ReferencedInstanceSequence;
  displaySet.referencedSeriesInstanceUID = referencedSeries.SeriesInstanceUID;

  displaySet.getReferenceDisplaySet = () => {
    const { displaySetService } = servicesManager.services;
    const referencedDisplaySets = displaySetService.getDisplaySetsForSeries(
      displaySet.referencedSeriesInstanceUID
    );

    if (!referencedDisplaySets || referencedDisplaySets.length === 0) {
      throw new Error('Referenced DisplaySet is missing for the SEG');
    }

    const referencedDisplaySet = referencedDisplaySets[0];

    displaySet.referencedDisplaySetInstanceUID = referencedDisplaySet.displaySetInstanceUID;

    // Todo: this needs to be able to work with other reference volumes (other than streaming) such as nifti, etc.
    displaySet.referencedVolumeURI = referencedDisplaySet.displaySetInstanceUID;
    const referencedVolumeId = `cornerstoneStreamingImageVolume:${displaySet.referencedVolumeURI}`;
    displaySet.referencedVolumeId = referencedVolumeId;

    return referencedDisplaySet;
  };

  displaySet.load = async ({ headers }) =>
    await _load(displaySet, servicesManager, extensionManager, headers);

  return [displaySet];
}

function _load(
  segDisplaySet,
  servicesManager: AppTypes.ServicesManager,
  extensionManager,
  headers
) {
  const { SOPInstanceUID } = segDisplaySet;
  const { segmentationService } = servicesManager.services;

  if (
    (segDisplaySet.loading || segDisplaySet.isLoaded) &&
    loadPromises[SOPInstanceUID] &&
    _segmentationExists(segDisplaySet, segmentationService)
  ) {
    return loadPromises[SOPInstanceUID];
  }

  segDisplaySet.loading = true;

  // We don't want to fire multiple loads, so we'll wait for the first to finish
  // and also return the same promise to any other callers.
  loadPromises[SOPInstanceUID] = new Promise(async (resolve, reject) => {
    if (!segDisplaySet.segments || Object.keys(segDisplaySet.segments).length === 0) {
      await _loadSegments({
        extensionManager,
        servicesManager,
        segDisplaySet,
        headers,
      });
    }

    const suppressEvents = true;
    segmentationService
      .createSegmentationForSEGDisplaySet(segDisplaySet, null, suppressEvents)
      .then(() => {
        segDisplaySet.loading = false;
        resolve();
      })
      .catch(error => {
        segDisplaySet.loading = false;
        reject(error);
      });
  });

  return loadPromises[SOPInstanceUID];
}

async function _loadSegments({
  extensionManager,
  servicesManager,
  segDisplaySet,
  headers,
}: withAppTypes) {
  const utilityModule = extensionManager.getModuleEntry(
    '@ohif/extension-cornerstone.utilityModule.common'
  );

  const { segmentationService, uiNotificationService } = servicesManager.services;
  const { dicomLoaderService } = utilityModule.exports;

  // 打印初始状态的 segDisplaySet
  console.log('初始的 segDisplaySet v1.0:', JSON.parse(JSON.stringify(segDisplaySet)));
  const arrayBuffer = await dicomLoaderService.findDicomDataPromise(segDisplaySet, null, headers);

  // 打印从 DICOM 数据下载的 arrayBuffer
  console.log('Downloaded DICOM data (arrayBuffer):', arrayBuffer);

  const cachedReferencedVolume = cache.getVolume(segDisplaySet.referencedVolumeId);
  console.log('Cached referenced volume:', cachedReferencedVolume);

  if (!cachedReferencedVolume) {
    throw new Error(
      'Referenced Volume is missing for the SEG, and stack viewport SEG is not supported yet'
    );
  }

  const { imageIds } = cachedReferencedVolume;

  // Todo: what should be defaults here
  const tolerance = 0.001;
  const skipOverlapping = true;

  eventTarget.addEventListener(Enums.Events.SEGMENTATION_LOAD_PROGRESS, evt => {
    const { percentComplete } = evt.detail;
    segmentationService._broadcastEvent(segmentationService.EVENTS.SEGMENT_LOADING_COMPLETE, {
      percentComplete,
    });
  });

  ///重要0718
  const results = await adaptersSEG.Cornerstone3D.Segmentation.generateToolState(
    imageIds,
    arrayBuffer,
    metaData,
    { skipOverlapping, tolerance, eventTarget, triggerEvent }
  );
  console.log('result是啥', results);

  ///result在這
  let usedRecommendedDisplayCIELabValue = true;
  results.segMetadata.data.forEach((data, i) => {
    if (i > 0) {
      data.rgba = data.RecommendedDisplayCIELabValue;

      if (data.rgba) {
        data.rgba = dicomlabToRGB(data.rgba);
      } else {
        usedRecommendedDisplayCIELabValue = false;
        data.rgba = CONSTANTS.COLOR_LUT[i % CONSTANTS.COLOR_LUT.length];
      }
    }
  });

  if (results.overlappingSegments) {
    uiNotificationService.show({
      title: 'Overlapping Segments',
      message:
        'Unsupported overlapping segments detected, segmentation rendering results may be incorrect.',
      type: 'warning',
    });
  }

  if (!usedRecommendedDisplayCIELabValue) {
    // Display a notification about the non-utilization of RecommendedDisplayCIELabValue
    uiNotificationService.show({
      title: 'DICOM SEG import',
      message:
        'RecommendedDisplayCIELabValue not found for one or more segments. The default color was used instead.',
      type: 'warning',
      duration: 5000,
    });
  }

  // 合并数据到 segDisplaySet
  Object.assign(segDisplaySet, results);
  // 修改 data 中的 rgba 值
  results.segMetadata.data.forEach((data, i) => {
    if (i >= 1 && i <= 10) {
      data.rgba = [128, 0, 128]; // 修改为紫色
    }
  });

  /*results.centroids.forEach((value, key) => {
    console.log(`索引: ${key}, 原始資料:`, value);

    // 修改 centroids 的值，
    value.x += 0;
    value.y += 0;
    value.z += 120;

    console.log(`已更新索引 ${key} 的資料為`, value);
  });
  */

  // 遍歷並將 Int16Array 中的所有值設置為 0
  /*
  const int16Array = new Int16Array(results.labelmapBufferArray[0]);
  for (let i = 0; i < int16Array.length; i++) {
    int16Array[i] = 1; // 將每個值設置為 0
  }

  // 將修改後的 Int16Array 緩衝區賦值回 labelmapBufferArray
  results.labelmapBufferArray[0] = int16Array.buffer;
  */

  // 打印合并后的完整状态的 segDisplaySet
  console.log('處理完最終要去下游的 segDisplaySet:', JSON.parse(JSON.stringify(segDisplaySet)));
}

function _segmentationExists(segDisplaySet, segmentationService: AppTypes.SegmentationService) {
  // This should be abstracted with the CornerstoneCacheService
  return segmentationService.getSegmentation(segDisplaySet.displaySetInstanceUID);
}

function getSopClassHandlerModule({ servicesManager, extensionManager }) {
  console.log('getsopclasshandlermodule初始化時，已被調用!');
  const getDisplaySetsFromSeries = instances => {
    return _getDisplaySetsFromSeries(instances, servicesManager, extensionManager);
  };

  return [
    {
      name: 'dicom-seg',
      sopClassUids,
      getDisplaySetsFromSeries,
    },
  ];
}

export default getSopClassHandlerModule;
