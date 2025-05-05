if (typeof browserAPI === 'undefined') {
  // Polyfill for cross-browser compatibility
  var browserAPI = typeof browser !== 'undefined' ? browser : chrome;
}
// Listen for messages with predictions
browserAPI.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'FIND_ELEMENTS') {
      const pageScrollX = message.scroll.scrollX;
      const pageScrollY = message.scroll.scrollY;
  
      if (!Array.isArray(message.decision)) {
        console.error('Decisions array is not valid.');
        return;
      }
      
      // Gets the bounding boxes of ads
      const adPredictions = message.decision
        .filter(decision => decision.isAd)
        .map(decision => {
          const boundingBox = decision.details.objectDetection.bbox;
          // Store both the viewport coordinates and the absolute page coordinates
          return {
            // Absolute page coordinates (independent of scroll)
            pageX: boundingBox.x + pageScrollX,
            pageY: boundingBox.y + pageScrollY,
            width: boundingBox.width,
            height: boundingBox.height,
            confidence: decision.details.objectDetection.confidence || 0.5,
          };
        });
      
      // Find and remove elements that match the bounding boxes
      const result = findAndRemoveAdElements(adPredictions);
      
      // Send response back if needed
      sendResponse({ 
        success: true, 
        adsRemoved: result.removed,
        adsFiltered: result.filtered 
      });
    }
    return true;
  });
  
 //Find and remove elements that match the given bounding boxes
 function findAndRemoveAdElements(adPredictions) {
    if (adPredictions.length === 0) return { removed: 0, filtered: 0 };
    
    let removedCount = 0;
    let filteredCount = 0;
    
    // Get current scroll position
    const currentScrollX = window.scrollX;
    const currentScrollY = window.scrollY;
    
    // Get elements in the DOM that are visible
    const visibleElements = Array.from(document.querySelectorAll('*')).filter(el => {
      // Skip non-rendered elements
      if (el.offsetParent === null && el.tagName !== 'BODY') return false;
      
      // Skip elements that are obviously not ads
      if (el.tagName === 'HTML' || el.tagName === 'HEAD' || el.tagName === 'SCRIPT' || el.tagName === 'STYLE' || el.tagName === 'META' || el.tagName === 'LINK') {
        return false;
      }
      
      // Skip main content areas
      const isMainContentContainer = (
        el === document.body ||
        el === document.documentElement ||
        // Check by element role
        el.getAttribute('role') === 'main' ||
        el.getAttribute('role') === 'article'
      );
      
      // Check for iframes - common for ads
      const isIframe = el.tagName === 'IFRAME';
      
      // Get bounding rect
      const rect = el.getBoundingClientRect();
      
      // Skip very large elements (likely containers, not ads) unless they're iframes
      const isLargeElement = rect.width > window.innerWidth * 0.9 && rect.height > window.innerHeight * 0.9;
      
      return !isMainContentContainer && (!isLargeElement || isIframe);
    });
    
    // Process each ad prediction
    adPredictions.forEach(prediction => {
      // Use the absolute page coordinates and convert to current viewport coordinates
      const viewportAdjustedX = prediction.pageX - currentScrollX;
      const viewportAdjustedY = prediction.pageY - currentScrollY;
      
      // Create a rectangle representing the ad in current viewport coordinates
      const adRect = {
        left: viewportAdjustedX,
        top: viewportAdjustedY,
        right: viewportAdjustedX + prediction.width,
        bottom: viewportAdjustedY + prediction.height
      };
      
      // Find elements by position matching (using viewport coordinates directly)
      const candidates = visibleElements.map(element => {
        const elementRect = element.getBoundingClientRect();
        
        // Since getBoundingClientRect() gives viewport coordinates, we can use them directly
        const elementViewport = {
          left: elementRect.left,
          top: elementRect.top,
          right: elementRect.right,
          bottom: elementRect.bottom,
          width: elementRect.width,
          height: elementRect.height
        };
        
        // Calculate overlap between ad and element in viewport coordinates
        const overlapResult = calculateOverlap(adRect, elementViewport);
        
        // Be more lenient with overlap requirements
        if (overlapResult.overlapPercentage < 0.15) return null; // Require at least 15% overlap
        
        // Calculate center distance in viewport coordinates
        const adCenterX = adRect.left + (adRect.right - adRect.left) / 2;
        const adCenterY = adRect.top + (adRect.bottom - adRect.top) / 2;
        const elementCenterX = elementViewport.left + elementViewport.width / 2;
        const elementCenterY = elementViewport.top + elementViewport.height / 2;
        const centerDistance = Math.sqrt(
          Math.pow(adCenterX - elementCenterX, 2) + 
          Math.pow(adCenterY - elementCenterY, 2)
        );
        
        // Calculate size difference, but don't penalize containers
        const adArea = prediction.width * prediction.height;
        const elementArea = elementViewport.width * elementViewport.height;
        // Size difference as percentage of ad size
        const sizeDifference = Math.abs(adArea - elementArea) / Math.max(adArea, elementArea);
        
        return {
          element,
          overlapPercentage: overlapResult.overlapPercentage,
          centerDistance,
          sizeDifference,
          elementRect: elementViewport
        };
      }).filter(Boolean); // Remove null values
      
      // Score candidates based on visual/structural metrics only
      const scoredCandidates = candidates
        .map(candidate => {
          // Calculate a combined score
          let score = 0;
          const element = candidate.element;
          const elementRect = candidate.elementRect;
          
          // position analysis
          // bounding box overlap
          score -= candidate.overlapPercentage * 12;
          // distance from bounding box center
          score += candidate.centerDistance * 0.005;
          // size difference between element and bounding box
          const isElementBiggerThanAd = elementRect.width * elementRect.height > prediction.width * prediction.height;
          // penalize size difference more if the element is smaller than the ad
          if (isElementBiggerThanAd) {
            score += candidate.sizeDifference * 1.5;
          } else {
            score += candidate.sizeDifference * 3;
          }

          // top of page banner ad check
          if (elementRect.top < 200) {
            score -= 1;
          }
          
          // check for fixed position elements (sticky ads)
          const computedStyle = window.getComputedStyle(element);
          if (computedStyle.position === 'fixed' || computedStyle.position === 'sticky') {
            score -= 2;
          }
          
          // structural analysis
          // check for iframes
          if (element.tagName === 'IFRAME') {
            score -= 4;
            // checking if the iframe cross-origin = higher chance of being an ad
            try {
              // if null it's cross-origin
              if (element.contentDocument === null) {
                score -= 2;
              }
            } catch (e) {
              // Security exception it's cross-origin
              score -= 2;
            }
          }
          
          // Check for div with background image but minimal content
          if (element.tagName === 'DIV') {
            const computedStyle = window.getComputedStyle(element);
            const hasBackgroundImage = computedStyle.backgroundImage && computedStyle.backgroundImage !== 'none';
            const hasMinimalContent = element.children.length < 3 && element.textContent.trim().length < 50;
            if (hasBackgroundImage && hasMinimalContent) {
              score -= 3;
            }
          }
          
          // aspect ratio analysis
          // check for common ad aspect ratios
          const aspectRatio = elementRect.width / elementRect.height;
          const isCommonAdRatio = (
            (aspectRatio > 2.5 && aspectRatio < 8.5) || // banners
            (aspectRatio > 0.8 && aspectRatio < 1.2) || // ~1:1 squares
            (aspectRatio > 1.7 && aspectRatio < 2.3) || // ~2:1 rectangles
            (aspectRatio > 0.25 && aspectRatio < 0.4)   // ~1:3 skyscraper
          );
          if (isCommonAdRatio) {
            score -= 2; 
          }
          
          // content analysis
          // checks for interactive elements
          const interactiveElements = element.querySelectorAll('button, input, select, textarea');
          if (interactiveElements.length <= 1) {
            score -= 1;
          }
          // analyze images inside the element
          const images = element.querySelectorAll('img');
          if (images.length === 1 && element.children.length < 3) { //check if there are minimal child elements
            score -= 1.5;
          }
          
          // isolated element check
          // check if element is in a seperate containerw
          const siblings = element.parentElement ? Array.from(element.parentElement.children) : [];
          
          if (siblings.length < 3 && element.parentElement !== document.body) {
            // check if element is in a container with few siblings - common for ads
            score -= 1;
          }
          
          return {
            ...candidate,
            score
          };
        })
        .sort((a, b) => a.score - b.score); // Sort by score 
      
      // Find the best candidate with a more permissive threshold
      if (scoredCandidates.length > 0 && scoredCandidates[0].score < 3) {
        const bestCandidate = scoredCandidates[0];
        
        // Check if this element has a better parent match
        let elementToRemove = bestCandidate.element;
        let currentBestScore = bestCandidate.score;
        
        // Check if parent might be a better match
        if (elementToRemove.parentElement && elementToRemove.parentElement !== document.body) {
          const parentElement = elementToRemove.parentElement;
          const parentRect = parentElement.getBoundingClientRect();
          
          // Calculate parent overlap
          const parentViewport = {
            left: parentRect.left,
            top: parentRect.top,
            right: parentRect.right,
            bottom: parentRect.bottom
          };
          
          const parentOverlap = calculateOverlap(adRect, parentViewport);
          
          // check if parent has good overlap and few children
          if (parentOverlap.overlapPercentage > 0.5 && 
              parentElement.children.length < 5 && 
              !isImportantElement(parentElement)) {
            // Check if removing the parent is better
            elementToRemove = parentElement;
          }
        }
        
        // check to prevent removal of important elements
        const isImportant = isImportantElement(elementToRemove);
        // if element is important, check its children
        if (isImportant) {
          // process children to find potential ad elements within the important container
          const childCandidates = processChildrenForAds(elementToRemove, adRect);
          if (childCandidates.length > 0) {
            // found suitbale child element to remove
            elementToRemove = childCandidates[0].element;
            currentBestScore = childCandidates[0].score;
            console.log('Found child element in important container to remove instead:', elementToRemove);
          } else {
            // no suitable children found, skip removal and ignore prediction
            filteredCount++;
            console.log('Important element has no suitable ad children:', elementToRemove);
            return;
          }
        }
        
        // Double-check that the selected element is not important
        if (isImportantElement(elementToRemove)) {
          filteredCount++;
          console.log('Selected element is important, skipping removal:', elementToRemove);
          return;
        }
        
        handlePlaceholder(elementToRemove);
        removedCount++;
        console.log('Removed ad element:', elementToRemove, 'with score:', currentBestScore);
      } else {
        // I had issues with banner ads being considered important elements
        // So try a more aggressive approach for clear banner ads
        const bannerCandidates = candidates.filter(candidate => {
          const element = candidate.element;
          const rect = element.getBoundingClientRect();
          
          // Check for obvious banner characteristics
          const isBannerShaped = rect.width > rect.height * 2.5; // Wide rectangle
          const isTopPositioned = rect.top < 200; // Near top of page
          const isIframe = element.tagName === 'IFRAME';
          const hasSingleImage = element.querySelectorAll('img').length === 1;
          
          return isBannerShaped && 
                 (isTopPositioned || isIframe || hasSingleImage) && 
                 candidate.overlapPercentage > 0.3;
        });
        
        if (bannerCandidates.length > 0) {
          let bannerElement = bannerCandidates[0].element;
          
          // Check if the banner is in an important element
          if (isImportantElement(bannerElement)) {
            // Process children to find potential ad elements
            const childCandidates = processChildrenForAds(bannerElement, adRect);
            
            if (childCandidates.length > 0) {
              // Found a child element to remove instead
              bannerElement = childCandidates[0].element;
              console.log('Found child banner element in important container:', bannerElement);
              
              //Check if the child is also important
              if (isImportantElement(bannerElement)) {
                filteredCount++;
                console.log('Child banner element is also important, skipping removal');
                return;
              }
            } else {
              // No suitable children found, skip this one
              filteredCount++;
              console.log('Important banner element has no suitable ad children');
              return; // Skip this ad prediction
            }
          }
          handlePlaceholder(bannerElement);
          removedCount++;
          console.log('Removed banner element through secondary detection:', bannerElement);
        } else {
          // No good match found
          filteredCount++;
        }
      }
    });
    
    return { removed: removedCount, filtered: filteredCount };
  }
  
  // Handles placeholder creation for ad element based on user preference
  function handlePlaceholder(element) {
    // Get the user preference for creating placeholders
    return browserAPI.storage.local.get(['createPlaceholders'], function(result) {
      // Default to true if setting doesn't exist
      const createPlaceholders = result.createPlaceholders !== undefined ? result.createPlaceholders : true;
      
      if (createPlaceholders) {
        // Create a placeholder to maintain the layout
        createPlaceholder(element);
      } else {
        //hide the element without creating placeholder
        element.style.display = 'none';
        element.dataset.removedAd = 'true';
      }
    });
  }
  
  //Process children of an important element to find potential ad elements
  function processChildrenForAds(parentElement, adRect) {
    // Get all immediate children
    const children = Array.from(parentElement.children);
    
    // Filter to visible children
    const visibleChildren = children.filter(child => {
      const style = window.getComputedStyle(child);
      return style.display !== 'none' && style.visibility !== 'hidden' && child.offsetParent !== null;
    });
    
    // No children to check
    if (visibleChildren.length === 0) {
      return [];
    }
    
    // Score each child
    const scoredChildren = visibleChildren.map(child => {
      // check if the child itself is important
      if (isImportantElement(child)) {
        // If the child is important, try to find ad elements within it recursively
        const nestedCandidates = processChildrenForAds(child, adRect);
        
        // If we found nested candidates, return the best one
        if (nestedCandidates.length > 0) {
          return {
            element: nestedCandidates[0].element,
            score: nestedCandidates[0].score,
            overlapPercentage: nestedCandidates[0].overlapPercentage,
            isRecursive: true  
          };
        }
        return null;
      }
      
      const childRect = child.getBoundingClientRect();
      
      // Create child viewport rectangle
      const childViewport = {
        left: childRect.left,
        top: childRect.top,
        right: childRect.right,
        bottom: childRect.bottom,
        width: childRect.width,
        height: childRect.height
      };
      
      // Calculate overlap with ad
      const overlapResult = calculateOverlap(adRect, childViewport);
      
      // Skip if insufficient overlap
      if (overlapResult.overlapPercentage < 0.2) {
        return null;
      }
      
      // Initial score based on overlap
      let score = 0;
      score -= overlapResult.overlapPercentage * 10;
      
      // Check for iframes
      if (child.tagName === 'IFRAME') {
        score -= 5;
        
        try {
          // Cross-origin iframe check
          if (child.contentDocument === null) {
            score -= 3;
          }
        } catch (e) {
          score -= 3;
        }
      }
      
      // Check for divs with background image
      if (child.tagName === 'DIV') {
        const computedStyle = window.getComputedStyle(child);
        const hasBackgroundImage = computedStyle.backgroundImage && computedStyle.backgroundImage !== 'none';
        const hasMinimalContent = child.children.length < 3 && child.textContent.trim().length < 50;
        if (hasBackgroundImage && hasMinimalContent) {
          score -= 4;
        }
      }

      // Check for images
      if (child.tagName === 'IMG' || child.querySelector('img')) {
        score -= 3;
      }
      
      // Common ad aspect ratios
      const aspectRatio = childViewport.width / childViewport.height;
      const isCommonAdRatio = (
        (aspectRatio > 2.5 && aspectRatio < 8.5) || // banner
        (aspectRatio > 0.8 && aspectRatio < 1.2) || // square
        (aspectRatio > 1.7 && aspectRatio < 2.3) || // rectangle
        (aspectRatio > 0.25 && aspectRatio < 0.4)   // skyscraper
      );
      if (isCommonAdRatio) {
        score -= 2;
      }
      
      // Check for isolated elements
      const siblings = Array.from(child.parentElement.children);
      if (siblings.length < 3) {
        score -= 1;
      }
      
      // Check for minimal content with a link
      if (child.querySelectorAll('a').length === 1 && child.textContent.trim().length < 100) {
        score -= 2;
      }
      
      return {
        element: child,
        score,
        overlapPercentage: overlapResult.overlapPercentage
      };
    }).filter(Boolean);
    
    // Sort by score
    return scoredChildren.sort((a, b) => a.score - b.score);
  }
  
  //Check if an element is too important to remove
  function isImportantElement(element) {
    const essentialRoles = ['navigation', 'banner', 'main', 'search', 'dialog'];
    if (element.getAttribute('role') && essentialRoles.includes(element.getAttribute('role'))) {
      return true;
    }
    
    // check URLs/links in the element - don't block elements with many internal links
    const links = element.querySelectorAll('a');
    if (links.length > 3) {
      let internalLinks = 0;
      for (const link of links) {
        if (link.href && link.href.includes(window.location.hostname)) {
          internalLinks++;
        }
      }
      
      // checks if most links are internal, likely for navigation or content
      if (internalLinks / links.length > 0.7) {
        return true;
      }
    }
    
    // check for search functionality by input types
    if (element.querySelector('input[type="search"]') || 
        (element.querySelector('input[type="text"]') && element.querySelector('button'))) {
      return true;
    }
    
    // check for authentication forms by input types
    if (element.querySelector('input[type="password"]')) {
      return true;
    }
    
    // check for substantial article content by structure
    const hasParagraphs = element.querySelectorAll('p').length > 2;
    const hasHeadings = element.querySelectorAll('h1, h2, h3, h4, h5, h6').length > 0;
    
    if (hasParagraphs && hasHeadings) {
      return true;
    }
    
    // check for multiple interactivve elements
    const formElements = element.querySelectorAll('input, select, textarea');
    if (formElements.length > 2) {
      return true;
    }
    
    // check for video content
    if (element.querySelector('video')) {
      return true;
    }
    const hasResultStructure = element.querySelector('h3') && 
                           (element.querySelector('a') || element.querySelector('cite'));
    if (hasResultStructure) {
      return true;
    }
    
    // check for result-like structure
    const hasResultLayout = element.querySelector('h3, h2') && 
                          element.querySelectorAll('p, div').length > 1 &&
                          element.querySelector('a[href]');
    if (hasResultLayout) {
      return true;
    }

    return false;
  }
  
  //Calculate overlap between two rectangles
  function calculateOverlap(rect1, rect2) {
    // Calculate the overlap area
    const overlapLeft = Math.max(rect1.left, rect2.left);
    const overlapTop = Math.max(rect1.top, rect2.top);
    const overlapRight = Math.min(rect1.right, rect2.right);
    const overlapBottom = Math.min(rect1.bottom, rect2.bottom);
    
    // Check if there is an overlap
    if (overlapRight < overlapLeft || overlapBottom < overlapTop) {
      return { overlapArea: 0, overlapPercentage: 0 };
    }
    
    // Calculate area of overlap
    const overlapArea = (overlapRight - overlapLeft) * (overlapBottom - overlapTop);
    // Calculate area of the ad prediction box
    const rect1Area = (rect1.right - rect1.left) * (rect1.bottom - rect1.top);
    const rect2Area = (rect2.right - rect2.left) * (rect2.bottom - rect2.top);
    
    // Calculate percentage of overlap relative to smaller of the two areas
    // helps better identify elements that fully contain or are fully contained by ads
    const smallerArea = Math.min(rect1Area, rect2Area);
    const overlapPercentage = overlapArea / smallerArea;
    
    return {
      overlapArea,
      overlapPercentage
    }; 
  }

  function createPlaceholder(element) {
    // Get the element's dimensions
    const rect = element.getBoundingClientRect();
    
    // Create a placeholder to maintain the layout
    const placeholder = document.createElement('div');
    placeholder.style.width = rect.width + 'px';
    placeholder.style.height = rect.height + 'px';
    placeholder.style.display = 'block';
    placeholder.style.opacity = '0';
    placeholder.className = 'placeholder-element';
    
    // Replace the ad with the placeholder
    element.parentNode.insertBefore(placeholder, element);
    element.style.display = 'none';
    
    // Mark for debugging
    element.dataset.removedAd = 'true';
    
    return placeholder;
  }