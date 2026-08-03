---
id: ADR-0001
title: Build Booking Before Extracting Genesis
status: accepted
owner: founding-team
date: 2026-08-03
---

# Build Booking Before Extracting Genesis

## Context

Dự án có một Master Spec Booking SaaS hoàn chỉnh và nhiều ý tưởng về Genesis. Xây runtime hoặc platform Genesis độc lập trước sẽ tạo rủi ro over-engineering và không có use case thực để kiểm chứng.

## Problem

Xây Genesis độc lập trước Booking có thể tạo ra một framework lớn nhưng chưa chứng minh được giá trị, làm phân tán nguồn lực khỏi Pilot.

## Decision

Booking SaaS là sản phẩm ưu tiên. Genesis tồn tại trong cùng repository dưới dạng standards, workflows, templates, reviews và patterns được trích xuất từ quá trình triển khai Booking.

Một artifact chỉ trở thành Genesis Standard khi đã được dùng và kiểm chứng trong ít nhất một vertical slice thực tế. Pattern nên có nhiều lần sử dụng trước khi được tự động hóa.

## Trade-offs

Chấp nhận Genesis ban đầu thủ công và phát triển theo nhu cầu thực tế thay vì có runtime hoàn chỉnh ngay từ đầu.

## Consequences

### Positive

- Mọi standard đều dựa trên vấn đề thật.
- Tập trung vào Pilot và giao dịch thật.
- Giảm thời gian xây framework chưa tạo giá trị.
- Booking trở thành case study và conformance suite đầu tiên.

### Negative

- Genesis phát triển chậm hơn một platform độc lập.
- Một số workflow ban đầu còn thủ công.
- Cần kỷ luật ghi ADR, lesson và pattern sau mỗi sprint.
