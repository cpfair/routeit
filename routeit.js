routeit = {};
routeit.Route = [];
routeit.init = function(){
	routeit.Map = Raphael("draw-route", $(".draw-route").width(), $(".draw-route").height());

	$(".draw-route").mousedown(routeit.startDraw);
	$(".draw-route").mousemove(routeit.doDraw);
	$(".draw-route").mouseup(routeit.endDraw);
};

routeit.drawing = false;
routeit.startDraw = function(e){
	routeit.Map.clear();
	routeit.Route = [];
	routeit.drawing = true;
	routeit.lastPt = [e.offsetX, e.offsetY];
};

routeit.doDraw = function(e){
	if (!routeit.drawing) return;
	routeit.logPoint(e, false);
};

routeit.endDraw = function(e){
	routeit.drawing = false;
	routeit.logPoint(e, true);
	routeit.routeit();
};

routeit.logPoint = function(e, endpt){
	var pt = [e.offsetX, e.offsetY];
	var pointDist = Math.sqrt(Math.pow(routeit.lastPt[0] - pt[0],2) + Math.pow(routeit.lastPt[1] - pt[1],2));

	if (pointDist < 10) return; // Should really normalize to equidistant points after the fact, this is much easier though.
	var track = routeit.Map.path("M" + routeit.lastPt[0] + "," + routeit.lastPt[1] + " L" + pt[0] + "," + pt[1]);
	track.attr("stroke", "#888");

	track.attr("stroke-width", "3px");
	track.attr("arrow-end", "classic-wide-long");

	routeit.Route.unshift(pt);
	routeit.lastPt = pt;
};


routeit.routeit = function(){
	var segment_break_avg_thres = Math.PI / 3;
	var segment_break_stddev_thres_inv = 0.5;
	var segment_analyze_start_len = 5;
	var segment_min_len = 2;

	// The general idea is to split the route into as few straight segments as possible.
	// Actually doing this would be complicated, so instead we settle for using predefined thresholds to determine which segments are worthwhile.
	// So instead, since CPU cycles are cheap, we follow the path forward from the last segment, at each step considering all the possible partitions, and picking the longest that meets our criteria.
	// This concept is fine for sharp-ish corners, but complicated optimization algorithm or not, it'll never work well for longer curves.
	// Instead, we end up with a series of segments every ~segment_break_avg_thres rads.

	// My original idea was to divide segments based on a common rotational rate of change, but while that worked fine for longer curves, it didn't work as well for right angles.
	// This, because the high ROC only existed for 1 edge pair - difficult to distinguish from small track defects.

	// So, maybe a hybrid approach would work better - suppress new segment creation when the ROC is constant and not zero.
	// But then I'd need to fix my ROC calculation be based on the actual angles intead of vectors.

	var segments = [];
	var sinceLastSeg = [];
	console.log("Overall " + routeit._calcVectStats(routeit.Route,0,routeit.Route.length));
	for (var i = routeit.Route.length - 1; i >= 0; i--) {
		var pt = routeit.Route[i];
		sinceLastSeg.unshift(pt);
		if (sinceLastSeg.length < segment_analyze_start_len) continue;

		for (var x = sinceLastSeg.length-2; x > 1 ; x--) {
			var preSplitStats = routeit._calcVectStats(sinceLastSeg, 0, x);
			var postSplitStats = routeit._calcVectStats(sinceLastSeg, x, sinceLastSeg.length);
			var preSplitROCStats = routeit._calcVectROCStats(sinceLastSeg, 0, x);
			var postSplitROCStats = routeit._calcVectROCStats(sinceLastSeg, x, sinceLastSeg.length);
			var angleDelta = Math.abs(preSplitStats[0] - postSplitStats[0]);
			angleDelta = Math.PI - Math.abs(angleDelta - Math.PI);
			if (
					(	angleDelta > segment_break_avg_thres && // A large enough turn?
						preSplitROCStats[1] < segment_break_stddev_thres_inv &&  postSplitROCStats[1] < segment_break_stddev_thres_inv && // Segments on either side of break are relatively straight?
						sinceLastSeg.length - x >= segment_min_len // Don't create excessively short segments.
					) || (i == 0 && x == 2) // Don't leave segment unclosed once there are no more points left.
				) {

				// Split segment here
				console.log("Split with delta " + angleDelta + " between " + preSplitStats + " and " + postSplitStats);
				segments.push([[i + x, i + sinceLastSeg.length], postSplitStats, postSplitROCStats]);
				sinceLastSeg = sinceLastSeg.slice(0,x);
			}
		}
	}

	for (var s = 1; s < segments.length; s++) {
		var lastSeg = segments[s-1];
		var seg = segments[s];
		var turnDir = lastSeg[1][0] < seg[1][0];
		if (Math.abs(lastSeg[1][0] - seg[1][0]) > Math.PI){
			turnDir = !turnDir;
		}
		var startX = routeit.Route[lastSeg[0][0]][0]; // Terrible tuples
		var startY = routeit.Route[lastSeg[0][0]][1];
		routeit.Map.path("M" + startX + "," + startY + " L" + (startX + Math.cos(Math.PI+lastSeg[1][0]) * 20) + "," + (startY + Math.sin(Math.PI+lastSeg[1][0]) * 20)).attr({"stroke":"#f00", "stroke-width":"3px"});
		routeit.Map.path("M" + startX + "," + startY + " L" + (startX + Math.cos(Math.PI+seg[1][0]) * 20) + "," + (startY + Math.sin(Math.PI+seg[1][0]) * 20)).attr({"stroke":"#0f0", "stroke-width":"3px"});
		routeit.Map.text(routeit.Route[lastSeg[0][0]][0] + 31, routeit.Route[lastSeg[0][0]][1] + 31, turnDir ? "Right":"Left").attr({"fill":"#000", "font-size":"30px", "text-shadow":"1px 1px solid black"});
		routeit.Map.text(routeit.Route[lastSeg[0][0]][0] + 30, routeit.Route[lastSeg[0][0]][1] + 30, turnDir ? "Right":"Left").attr({"fill":"#ffffff", "font-size":"30px", "text-shadow":"1px 1px solid black"});
	}

};

routeit._calcVectStats = function(pts, start, end){
	var vectlist = [];
	// We can't just average the angle itself because it wraps around at 2PI
	// But we can average the vectors.
	// Trig functions are cheap, right?

	var angX = 0;
	var angY = 0;
	for (var i = end - 2; i >= start; i--) {
		vect = routeit._calcVect(pts[i], pts[i + 1]) || 0;
		angX += Math.cos(vect);
		angY += Math.sin(vect);
		vectlist.unshift(vect);
	}

	angX = angX / vectlist.length;
	angY = angY / vectlist.length;
	var avg = Math.atan2(angY, angX);
	var stddev = 0;
	for (var x = vectlist.length - 1; x >= 0; x--) {
		stddev += Math.pow(vectlist[x] - avg, 2);
	}
	stddev = Math.sqrt(stddev/vectlist.length);
	return [avg, stddev];
};

// ROC = rate of change.
routeit._calcVectROCStats = function(pts, start, end){
	var ROClist = [];
	var avg = 0;
	for (var i = end - 3; i >= start; i--) {
		dist = routeit._calcDist(pts, i, i + 1);
		vect = routeit._calcVect(pts[i], pts[i + 1]) || 0;
		lastVect = routeit._calcVect(pts[i + 1], pts[i + 2]) || 0;
		// Same vector-conversion shenanigans here to avoid issues with the wraparound.
		delta = Math.sqrt(Math.pow(Math.sin(vect) - Math.sin(lastVect), 2) + Math.pow(Math.cos(vect) - Math.cos(lastVect), 2))
		if (dist == 0) continue;
		var ROC = delta / dist;
		avg += ROC;
		ROClist.unshift(ROC);
	}

	avg = avg / ROClist.length;
	var stddev = 0;
	for (var x = ROClist.length - 1; x >= 0; x--) {
		stddev += Math.pow(ROClist[x] - avg, 2);
	}
	stddev = Math.sqrt(stddev/ROClist.length);
	return [avg, stddev];
};

routeit._calcVect = function(pt1, pt2) {
	return Math.atan2(pt1[1] - pt2[1], pt1[0] - pt2[0]) + Math.PI; // 0~2PI
};

routeit._calcDist = function(pts, start, end){
	var dist = 0;
	for (var i = end - 1; i >= start; i--) {
		dist += Math.sqrt(Math.pow((pts[i][0] - pts[i + 1][0]),2) + Math.pow((pts[i][1] - pts[i + 1][1]), 2));
	}
	return dist;
};

$(function(){
	routeit.init();
});